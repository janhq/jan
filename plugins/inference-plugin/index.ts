import {
  EventName,
  InferenceService,
  NewMessageRequest,
  PluginService,
  events,
  store,
  invokePluginFunc,
} from "@janhq/core";
import { Observable } from "rxjs";

const initModel = async (product) =>
  invokePluginFunc(MODULE_PATH, "initModel", product);

const stopModel = () => {
  invokePluginFunc(MODULE_PATH, "killSubprocess");
};

function requestInference(
  recentMessages: any[],
  bot?: any
): Observable<string> {
  return new Observable((subscriber) => {
    const requestBody = JSON.stringify({
      messages: recentMessages,
      stream: true,
      model: "gpt-3.5-turbo",
      max_tokens: bot?.maxTokens ?? 2048,
      frequency_penalty: bot?.frequencyPenalty ?? 0,
      presence_penalty: bot?.presencePenalty ?? 0,
      temperature: bot?.customTemperature ?? 0,
    });
    console.debug(`Request body: ${requestBody}`);
    fetch(INFERENCE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Access-Control-Allow-Origin": "*",
      },
      body: requestBody,
    })
      .then(async (response) => {
        const stream = response.body;
        const decoder = new TextDecoder("utf-8");
        const reader = stream?.getReader();
        let content = "";

        while (true && reader) {
          const { done, value } = await reader.read();
          if (done) {
            console.log("SSE stream closed");
            break;
          }
          const text = decoder.decode(value);
          const lines = text.trim().split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ") && !line.includes("data: [DONE]")) {
              const data = JSON.parse(line.replace("data: ", ""));
              content += data.choices[0]?.delta?.content ?? "";
              if (content.startsWith("assistant: ")) {
                content = content.replace("assistant: ", "");
              }
              subscriber.next(content);
            }
          }
        }
        subscriber.complete();
      })
      .catch((err) => subscriber.error(err));
  });
}

async function retrieveLastTenMessages(conversationId: string, bot?: any) {
  // TODO: Common collections should be able to access via core functions instead of store
  const messageHistory =
    (await store.findMany("messages", { conversationId }, [
      { createdAt: "asc" },
    ])) ?? [];

  let recentMessages = messageHistory
    .filter(
      (e) => e.message !== "" && (e.user === "user" || e.user === "assistant")
    )
    .slice(-9)
    .map((message) => ({
      content: message.message.trim(),
      role: message.user === "user" ? "user" : "assistant",
    }));

  if (bot && bot.systemPrompt) {
    // append bot's system prompt
    recentMessages = [
      {
        content: `[INST] ${bot.systemPrompt}`,
        role: "system",
      },
      ...recentMessages,
    ];
  }

  console.debug(`Last 10 messages: ${JSON.stringify(recentMessages, null, 2)}`);

  return recentMessages;
}

async function handleMessageRequest(data: NewMessageRequest) {
  const conversation = await store.findOne(
    "conversations",
    data.conversationId
  );
  let bot = undefined;
  if (conversation.botId != null) {
    bot = await store.findOne("bots", conversation.botId);
  }

  const recentMessages = await retrieveLastTenMessages(
    data.conversationId,
    bot
  );
  const message = {
    ...data,
    message: "",
    user: "assistant",
    createdAt: new Date().toISOString(),
    _id: undefined,
  };
  // TODO: Common collections should be able to access via core functions instead of store
  const id = await store.insertOne("messages", message);

  message._id = id;
  events.emit(EventName.OnNewMessageResponse, message);

  requestInference(recentMessages, bot).subscribe({
    next: (content) => {
      message.message = content;
      events.emit(EventName.OnMessageResponseUpdate, message);
    },
    complete: async () => {
      message.message = message.message.trim();
      // TODO: Common collections should be able to access via core functions instead of store
      await store.updateOne("messages", message._id, message);
    },
    error: async (err) => {
      message.message =
        message.message.trim() + "\n" + "Error occurred: " + err.message;
      events.emit(EventName.OnMessageResponseUpdate, message);
      // TODO: Common collections should be able to access via core functions instead of store
      await store.updateOne("messages", message._id, message);
    },
  });
}

async function inferenceRequest(data: NewMessageRequest): Promise<any> {
  const message = {
    ...data,
    message: "",
    user: "assistant",
    createdAt: new Date().toISOString(),
  };
  return new Promise(async (resolve, reject) => {
    const recentMessages = await retrieveLastTenMessages(data.conversationId);
    requestInference([
      ...recentMessages,
      { role: "user", content: data.message },
    ]).subscribe({
      next: (content) => {
        message.message = content;
      },
      complete: async () => {
        resolve(message);
      },
      error: async (err) => {
        reject(err);
      },
    });
  });
}

const registerListener = () => {
  events.on(EventName.OnNewMessageRequest, handleMessageRequest);
};

const onStart = async () => {
  registerListener();
};
// Register all the above functions and objects with the relevant extension points
export function init({ register }) {
  register(PluginService.OnStart, PLUGIN_NAME, onStart);
  register(InferenceService.InitModel, initModel.name, initModel);
  register(InferenceService.StopModel, stopModel.name, stopModel);
  register(
    InferenceService.InferenceRequest,
    inferenceRequest.name,
    inferenceRequest
  );
}
