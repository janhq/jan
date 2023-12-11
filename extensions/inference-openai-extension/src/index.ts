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
  ModelEvent,
  InferenceEvent,
  MessageEvent,
  MessageRequest,
  MessageStatus,
  ModelSettingParams,
  ExtensionType,
  ThreadContent,
  ThreadMessage,
  fs,
} from "@janhq/core";
import { BaseExtension, InferenceInterface } from "@janhq/core";
import { requestInference } from "./helpers/sse";
import { ulid } from "ulid";
import { join } from "path";
import { EngineSettings, OpenAIModel } from "./@types/global";

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceOpenAIExtension
  extends BaseExtension
  implements InferenceInterface
{
  private static readonly _homeDir = "engines";
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
  onLoad(): void {
    fs.mkdir(JanInferenceOpenAIExtension._homeDir);
    JanInferenceOpenAIExtension.writeDefaultEngineSettings();

    // Events subscription
    this.on(MessageEvent.OnMessageSent, (data) =>
      this.handleMessageRequest(data)
    );

    this.on(MessageEvent.OnMessageSent, (data) =>
      this.handleMessageRequest(data)
    );

    this.on(ModelEvent.OnModelInit, (model: OpenAIModel) => {
      this.handleModelInit(model);
    });

    this.on(ModelEvent.OnModelStop, (model: OpenAIModel) => {
      this.handleModelStop(model);
    });

    this.on(InferenceEvent.OnInferenceStopped, () => {
      this.handleInferenceStopped();
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
      if (await fs.exists(engineFile)) {
        JanInferenceOpenAIExtension._engineSettings = JSON.parse(
          await fs.readFile(engineFile)
        );
      } else {
        await fs.writeFile(
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

  private async handleModelInit(model: OpenAIModel) {
    if (model.engine !== "openai") {
      return;
    } else {
      JanInferenceOpenAIExtension._currentModel = model;
      JanInferenceOpenAIExtension.writeDefaultEngineSettings();
      // Todo: Check model list with API key
      this.emit(ModelEvent.OnModelReady, model);
    }
  }

  private async handleModelStop(model: OpenAIModel) {
    if (model.engine !== "openai") {
      return;
    }
    this.emit(ModelEvent.OnModelStopped, model);
  }

  private async handleInferenceStopped() {
    this.isCancelled = true;
    this.controller?.abort();
  }

  /**
   * Handles a new message request by making an inference request and emitting events.
   * Function registered in event manager, should be static to avoid binding issues.
   * Pass instance as a reference.
   * @param {MessageRequest} data - The data for the new message request.
   */
  private async handleMessageRequest(data: MessageRequest) {
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
    this.emit(MessageEvent.OnMessageResponse, message);

    this.isCancelled = false;
    this.controller = new AbortController();

    requestInference(
      data?.messages ?? [],
      JanInferenceOpenAIExtension._engineSettings,
      JanInferenceOpenAIExtension._currentModel,
      this.controller
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
        this.emit(MessageEvent.OnMessageUpdate, message);
      },
      complete: async () => {
        message.status = MessageStatus.Ready;
        this.emit(MessageEvent.OnMessageUpdate, message);
      },
      error: async (err) => {
        const messageContent: ThreadContent = {
          type: ContentType.Text,
          text: {
            value: "Error occurred: " + err.message,
            annotations: [],
          },
        };
        message.content = [messageContent];
        message.status = MessageStatus.Ready;
        this.emit(MessageEvent.OnMessageUpdate, message);
      },
    });
  }
}
