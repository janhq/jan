import { EventName, NewMessageRequest, events, store } from "@janhq/plugin-core";
import { Configuration, OpenAIApi } from "azure-openai";

const setRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
XMLHttpRequest.prototype.setRequestHeader = function newSetRequestHeader(key: string, val: string) {
  if (key.toLocaleLowerCase() === "user-agent") {
    return;
  }
  setRequestHeader.apply(this, [key, val]);
};

const openai = new OpenAIApi(
  new Configuration({
    azure: {
      apiKey: "", //Your API key goes here
      endpoint: "", //Your endpoint goes here. It is like: "https://endpointname.openai.azure.com/"
      deploymentName: "", //Your deployment name goes here. It is like "chatgpt"
    },
  })
);

async function handleMessageRequest(data: NewMessageRequest) {
  const message = {
    ...data,
    message: "",
    user: "GPT-3",
    avatar: "",
    createdAt: new Date().toISOString(),
    _id: undefined,
  };
  const id = await store.insertOne("messages", message);

  message._id = id;
  events.emit(EventName.OnNewMessageResponse, message);
  const response = await openai.createChatCompletion({
    messages: [{ role: "user", content: data.message }],
    model: "gpt-3.5-turbo",
  });
  message.message = response.data.choices[0].message.content;
  events.emit(EventName.OnMessageResponseUpdate, message);
  await store.updateOne("messages", message._id, message);
}

const registerListener = () => {
  events.on(EventName.OnNewMessageRequest, handleMessageRequest);
};
// Register all the above functions and objects with the relevant extension points
export function init({ register }) {
  registerListener();
}
