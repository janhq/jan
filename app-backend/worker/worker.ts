export interface Env {
  HASURA_ADMIN_API_KEY: string;
  LLM_INFERENCE_ENDPOINT: string;
  INFERENCE_API_KEY: string;
  HASURA_GRAPHQL_ENGINE_ENDPOINT: string;
}

export default {
  async fetch(request: Request, env: Env) {
    return handleRequest(env, request);
  },
};

async function handleRequest(env: Env, request: Request) {
  const apiurl = env.LLM_INFERENCE_ENDPOINT;
  const requestBody = await request.json();

  let lastCallTime = 0;
  let timeoutId: any;
  let done = true;

  function throttle(fn: () => void, delay: number) {
    return async function () {
      const now = new Date().getTime();
      const timeSinceLastCall = now - lastCallTime;

      if (timeSinceLastCall >= delay && done) {
        lastCallTime = now;
        done = false;
        await fn();
        done = true;
      } else {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(async () => {
          lastCallTime = now;
          done = false;
          await fn();
          done = true;
        }, delay - timeSinceLastCall);
      }
    };
  }

  const messageBody = {
    id: requestBody.event.data.new.id,
    content: requestBody.event.data.new.content,
    messages: requestBody.event.data.new.prompt_cache,
    status: requestBody.event.data.new.status,
  };

  if (messageBody.status !== "pending") {
    return new Response(JSON.stringify({ status: "success" }), {
      status: 200,
      statusText: "success",
    });
  }

  const llmRequestBody = {
    messages: messageBody.messages,
    stream: true,
    model: "gpt-3.5-turbo",
    max_tokens: 500,
  };

  const init = {
    body: JSON.stringify(llmRequestBody),
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: "Access-Control-Allow-Origin: *",
      "api-key": env.INFERENCE_API_KEY,
    },
    method: "POST",
  };
  return fetch(apiurl, init)
    .then((res) => res.body?.getReader())
    .then(async (reader) => {
      if (!reader) {
        console.error("Error: fail to read data from response");
        return;
      }
      let answer = "";
      let cachedChunk = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const textDecoder = new TextDecoder("utf-8");
        const chunk = textDecoder.decode(value);
        cachedChunk += chunk;
        const matched = cachedChunk.match(/data: {(.*)}/g);
        if (!matched) {
          continue;
        }

        let deltaText = "";
        for (const line of cachedChunk.split("\n")) {
          const trimmedLine = line.trim();
          if (!trimmedLine || trimmedLine === "data: [DONE]") {
            continue;
          }

          const json = trimmedLine.replace("data: ", "");
          try {
            const obj = JSON.parse(json);
            const content = obj.choices[0].delta.content;
            if (content) deltaText = deltaText.concat(content);
          } catch (e) {
            console.log(e);
          }
        }
        cachedChunk = "";

        answer = answer + deltaText;

        const variables = {
          id: messageBody.id,
          data: {
            content: answer,
          },
        };

        throttle(async () => {
          await fetch(env.HASURA_GRAPHQL_ENGINE_ENDPOINT + "/v1/graphql", {
            method: "POST",
            body: JSON.stringify({ query: updateMessageQuery, variables }),
            headers: {
              "Content-Type": "application/json",
              "x-hasura-admin-secret": env.HASURA_ADMIN_API_KEY,
            },
          })
            .catch((error) => {
              console.error(error);
            })
            .finally(() => console.log("++-- request sent"));
        }, 300)();
      }

      const variables = {
        id: messageBody.id,
        data: {
          status: "ready",
          prompt_cache: null,
        },
      };

      await fetch(env.HASURA_GRAPHQL_ENGINE_ENDPOINT + "/v1/graphql", {
        method: "POST",
        body: JSON.stringify({ query: updateMessageQuery, variables }),
        headers: {
          "Content-Type": "application/json",
          "x-hasura-admin-secret": env.HASURA_ADMIN_API_KEY,
        },
      }).catch((error) => {
        console.error(error);
      });

      const convUpdateVars = {
        id: requestBody.event.data.new.conversation_id,
        content: answer
      }
      await fetch(env.HASURA_GRAPHQL_ENGINE_ENDPOINT + "/v1/graphql", {
        method: "POST",
        body: JSON.stringify({ query: updateConversationquery, variables: convUpdateVars }),
        headers: {
          "Content-Type": "application/json",
          "x-hasura-admin-secret": env.HASURA_ADMIN_API_KEY,
        },
      }).catch((error) => {
        console.error(error);
      });

      return new Response(JSON.stringify({ status: "success" }), {
        status: 200,
        statusText: "success",
      });
    });
}

const updateMessageQuery = `
mutation chatCompletions($id: uuid = "", $data: messages_set_input) {
  update_messages_by_pk(pk_columns: {id: $id}, _set: $data) {
    id
    content
  }
}
`;

const updateConversationquery = `
mutation updateConversation($id: uuid = "", $content: String = "") {
  update_conversations_by_pk(pk_columns: {id: $id}, _set: {last_text_message: $content}) {
    id
  }
}
`
