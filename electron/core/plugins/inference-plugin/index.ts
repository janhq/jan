import { EventName, InferenceService, NewMessageRequest, core, events, store } from "@janhq/plugin-core";

const MODULE_PATH = "inference-plugin/dist/module.js";

const initModel = async (product) => core.invokePluginFunc(MODULE_PATH, "initModel", product);

const inferenceUrl = () => "http://localhost:3928/llama/chat_completion";

const stopModel = () => {
  core.invokePluginFunc(MODULE_PATH, "killSubprocess");
};

async function handleMessageRequest(data: NewMessageRequest) {
  // TODO: Common collections should be able to access via core functions instead of store
  const messageHistory = (await store.findMany("messages", { conversationId: data.conversationId })) ?? [];
  const recentMessages = messageHistory.slice(-10).map((message) => {
    return {
      content: message.message,
      role: message.user === "user" ? "user" : "assistant",
    };
  });

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

  const response = await fetch(inferenceUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "Access-Control-Allow-Origi": "*",
    },
    body: JSON.stringify({
      messages: recentMessages,
      stream: true,
      model: "gpt-3.5-turbo",
      max_tokens: 500,
    }),
  });
  const stream = response.body;

  const decoder = new TextDecoder("utf-8");
  const reader = stream?.getReader();
  let answer = "";

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
        answer += data.choices[0]?.delta?.content ?? "";
        if (answer.startsWith("assistant: ")) {
          answer = answer.replace("assistant: ", "");
        }
        message.message = answer;
        events.emit(EventName.OnMessageResponseUpdate, message);
      }
    }
  }
  // TODO: Common collections should be able to access via core functions instead of store
  await store.updateOne("messages", message._id, message);

  events.emit(EventName.OnMessageResponseFinished, message);
}

const registerListener = () => {
  events.on(EventName.OnNewMessageRequest, handleMessageRequest);
};
// Register all the above functions and objects with the relevant extension points
export function init({ register }) {
  registerListener();
  register(InferenceService.InitModel, initModel.name, initModel);
  register(InferenceService.StopModel, stopModel.name, stopModel);
}
