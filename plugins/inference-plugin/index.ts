import {
  EventName,
  InferenceService,
  NewMessageRequest,
  PluginService,
  events,
  executeOnMain,
  MessageHistory,
} from "@janhq/core";
import { Observable } from "rxjs";

const initModel = async (product) =>
  executeOnMain(MODULE_PATH, "initModel", product);

const stopModel = () => {
  executeOnMain(MODULE_PATH, "killSubprocess");
};

function requestInference(recentMessages: any[]): Observable<string> {
  return new Observable((subscriber) => {
    const requestBody = JSON.stringify({
      messages: recentMessages,
      stream: true,
      model: "gpt-3.5-turbo",
      max_tokens: 2048,
      // TODO: Enable back when character is available
      // frequency_penalty: 0,
      // presence_penalty: 0,
      // temperature: 0,
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

async function handleMessageRequest(data: NewMessageRequest) {
  const prompts: [MessageHistory] = [
    {
      role: "user",
      content: data.message,
    },
  ];
  const recentMessages = await (data.history ?? prompts);
  const message = {
    ...data,
    message: "",
    user: "assistant",
    createdAt: new Date().toISOString(),
    _id: `message-${Date.now()}`,
  };
  // TODO: Common collections should be able to access via core functions instead of store
  events.emit(EventName.OnNewMessageResponse, message);

  requestInference(recentMessages).subscribe({
    next: (content) => {
      message.message = content;
      events.emit(EventName.OnMessageResponseUpdate, message);
    },
    complete: async () => {
      message.message = message.message.trim();
      // TODO: Common collections should be able to access via core functions instead of store
      events.emit(EventName.OnMessageResponseFinished, message);
    },
    error: async (err) => {
      message.message =
        message.message.trim() + "\n" + "Error occurred: " + err.message;
      events.emit(EventName.OnMessageResponseUpdate, message);
      // TODO: Common collections should be able to access via core functions instead of store
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
  const prompts: [MessageHistory] = [
    {
      role: "user",
      content: data.message,
    },
  ];
  const recentMessages = await (data.history ?? prompts);

  return new Promise(async (resolve, reject) => {
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

const killSubprocess = () => {
  executeOnMain(MODULE_PATH, "killSubprocess");
};

const onStart = async () => {
  // Try killing any existing subprocesses related to Nitro
  killSubprocess();

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
