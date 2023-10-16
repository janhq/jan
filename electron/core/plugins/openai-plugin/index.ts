import {
  PluginService,
  EventName,
  NewMessageRequest,
  events,
  store,
  preferences,
  RegisterExtensionPoint,
} from "@janhq/plugin-core";
import { Configuration, OpenAIApi } from "azure-openai";

const PluginName = "openai-plugin";

const setRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
XMLHttpRequest.prototype.setRequestHeader = function newSetRequestHeader(key: string, val: string) {
  if (key.toLocaleLowerCase() === "user-agent") {
    return;
  }
  setRequestHeader.apply(this, [key, val]);
};

var openai: OpenAIApi | undefined = undefined;

const setup = async () => {
  const apiKey: string = (await preferences.get(PluginName, "apiKey")) ?? "";
  const endpoint: string = (await preferences.get(PluginName, "endpoint")) ?? "";
  const deploymentName: string = (await preferences.get(PluginName, "deploymentName")) ?? "";
  if (apiKey === "") {
    return;
  }
  openai = new OpenAIApi(
    new Configuration({
      azure: {
        apiKey, //Your API key goes here
        endpoint, //Your endpoint goes here. It is like: "https://endpointname.openai.azure.com/"
        deploymentName, //Your deployment name goes here. It is like "chatgpt"
      },
    })
  );
};

async function onStart() {
  setup();
  registerListener();
}

async function handleMessageRequest(data: NewMessageRequest) {
  if (!openai) {
    const message = {
      ...data,
      message: "Your API key is not set. Please set it in the plugin preferences.",
      user: "GPT-3",
      avatar: "",
      createdAt: new Date().toISOString(),
      _id: undefined,
    };
    const id = await store.insertOne("messages", message);
    message._id = id;
    events.emit(EventName.OnNewMessageResponse, message);
    return;
  }

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

const onPreferencesUpdate = () => {
  setup();
};
// Register all the above functions and objects with the relevant extension points
export function init({ register }: { register: RegisterExtensionPoint }) {
  register(PluginService.OnStart, PluginName, onStart);
  register(PluginService.OnPreferencesUpdate, PluginName, onPreferencesUpdate);

  preferences.registerPreferences<string>(register, PluginName, "apiKey", "API Key", "Azure Project API Key", "");
  preferences.registerPreferences<string>(
    register,
    PluginName,
    "endpoint",
    "API Endpoint",
    "Azure Deployment Endpoint API",
    ""
  );
  preferences.registerPreferences<string>(
    register,
    PluginName,
    "deploymentName",
    "Deployment Name",
    "The deployment name you chose when you deployed the model",
    ""
  );
}
