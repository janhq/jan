/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-openai-extension/src/index
 */

import {
  ChatCompletionRole,
  ContentType,
  EventName,
  MessageRequest,
  MessageStatus,
  ExtensionType,
  ThreadContent,
  ThreadMessage,
  events,
  fs,
  InferenceEngine,
} from "@janhq/core";
import { InferenceExtension } from "@janhq/core";
import { requestInference } from "./helpers/sse";
import { ulid } from "ulid";
import { join } from "path";

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceOpenAIExtension implements InferenceExtension {
  private static readonly _homeDir = "file://engines";
  private static readonly _engineMetadataFileName = "openai.json";

  private static _currentModel: OpenAIModel;

  private static _engineSettings: EngineSettings = {
    full_url: "https://api.openai.com/v1/chat/completions",
    api_key: "sk-<your key here>",
  };

  controller = new AbortController();
  isCancelled = false;

  /**
   * Returns the type of the extension.
   * @returns {ExtensionType} The type of the extension.
   */
  // TODO: To fix
  type(): ExtensionType {
    return undefined;
  }
  /**
   * Subscribes to events emitted by the @janhq/core package.
   */
  async onLoad() {
    if (!(await fs.existsSync(JanInferenceOpenAIExtension._homeDir))) {
      await fs
        .mkdirSync(JanInferenceOpenAIExtension._homeDir)
        .catch((err) => console.debug(err));
    }

    JanInferenceOpenAIExtension.writeDefaultEngineSettings();

    // Events subscription
    events.on(EventName.OnMessageSent, (data) =>
      JanInferenceOpenAIExtension.handleMessageRequest(data, this)
    );

    events.on(EventName.OnModelInit, (model: OpenAIModel) => {
      JanInferenceOpenAIExtension.handleModelInit(model);
    });

    events.on(EventName.OnModelStop, (model: OpenAIModel) => {
      JanInferenceOpenAIExtension.handleModelStop(model);
    });
    events.on(EventName.OnInferenceStopped, () => {
      JanInferenceOpenAIExtension.handleInferenceStopped(this);
    });
  }

  /**
   * Stops the model inference.
   */
  onUnload(): void {}

  static async writeDefaultEngineSettings() {
    try {
      const engineFile = join(
        JanInferenceOpenAIExtension._homeDir,
        JanInferenceOpenAIExtension._engineMetadataFileName
      );
      if (await fs.existsSync(engineFile)) {
        const engine = await fs.readFileSync(engineFile, "utf-8");
        JanInferenceOpenAIExtension._engineSettings =
          typeof engine === "object" ? engine : JSON.parse(engine);
      } else {
        await fs.writeFileSync(
          engineFile,
          JSON.stringify(JanInferenceOpenAIExtension._engineSettings, null, 2)
        );
      }
    } catch (err) {
      console.error(err);
    }
  }

  /**
   * Makes a single response inference request.
   * @param {MessageRequest} data - The data for the inference request.
   * @returns {Promise<any>} A promise that resolves with the inference response.
   */
  async inference(data: MessageRequest): Promise<ThreadMessage> {
    const timestamp = Date.now();

    const message: ThreadMessage = {
      thread_id: data.threadId,
      created: timestamp,
      updated: timestamp,
      status: MessageStatus.Ready,
      id: "",
      role: ChatCompletionRole.Assistant,
      object: "thread.message",
      content: [],
    };

    return new Promise(async (resolve, reject) => {
      requestInference(
        data.messages ?? [],
        JanInferenceOpenAIExtension._engineSettings,
        JanInferenceOpenAIExtension._currentModel
      ).subscribe({
        next: (_content) => {},
        complete: async () => {
          resolve(message);
        },
        error: async (err) => {
          reject(err);
        },
      });
    });
  }

  private static async handleModelInit(model: OpenAIModel) {
    if (model.engine !== InferenceEngine.openai) {
      return;
    } else {
      JanInferenceOpenAIExtension._currentModel = model;
      JanInferenceOpenAIExtension.writeDefaultEngineSettings();
      // Todo: Check model list with API key
      events.emit(EventName.OnModelReady, model);
    }
  }

  private static async handleModelStop(model: OpenAIModel) {
    if (model.engine !== "openai") {
      return;
    }
    events.emit(EventName.OnModelStopped, model);
  }

  private static async handleInferenceStopped(
    instance: JanInferenceOpenAIExtension
  ) {
    instance.isCancelled = true;
    instance.controller?.abort();
  }

  /**
   * Handles a new message request by making an inference request and emitting events.
   * Function registered in event manager, should be static to avoid binding issues.
   * Pass instance as a reference.
   * @param {MessageRequest} data - The data for the new message request.
   */
  private static async handleMessageRequest(
    data: MessageRequest,
    instance: JanInferenceOpenAIExtension
  ) {
    if (data.model.engine !== "openai") {
      return;
    }

    const timestamp = Date.now();
    const message: ThreadMessage = {
      id: ulid(),
      thread_id: data.threadId,
      assistant_id: data.assistantId,
      role: ChatCompletionRole.Assistant,
      content: [],
      status: MessageStatus.Pending,
      created: timestamp,
      updated: timestamp,
      object: "thread.message",
    };
    events.emit(EventName.OnMessageResponse, message);

    instance.isCancelled = false;
    instance.controller = new AbortController();

    requestInference(
      data?.messages ?? [],
      this._engineSettings,
      {
        ...JanInferenceOpenAIExtension._currentModel,
        parameters: data.model.parameters,
      },
      instance.controller
    ).subscribe({
      next: (content) => {
        const messageContent: ThreadContent = {
          type: ContentType.Text,
          text: {
            value: content.trim(),
            annotations: [],
          },
        };
        message.content = [messageContent];
        events.emit(EventName.OnMessageUpdate, message);
      },
      complete: async () => {
        message.status = message.content.length
          ? MessageStatus.Ready
          : MessageStatus.Error;
        events.emit(EventName.OnMessageUpdate, message);
      },
      error: async (err) => {
        if (instance.isCancelled || message.content.length > 0) {
          message.status = MessageStatus.Error;
          events.emit(EventName.OnMessageUpdate, message);
          return;
        }
        const messageContent: ThreadContent = {
          type: ContentType.Text,
          text: {
            value: "Error occurred: " + err.message,
            annotations: [],
          },
        };
        message.content = [messageContent];
        message.status = MessageStatus.Ready;
        events.emit(EventName.OnMessageUpdate, message);
      },
    });
  }
}
