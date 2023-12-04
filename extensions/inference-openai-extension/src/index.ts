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
  ModelSettingParams,
  ExtensionType,
  ThreadContent,
  ThreadMessage,
  events,
  executeOnMain,
  getUserSpace,
  fs,
  Model,
} from "@janhq/core";
import { InferenceExtension } from "@janhq/core";
import { requestInference } from "./helpers/sse";
import { ulid } from "ulid";
import { join } from "path";

interface EngineSettings {
  base_url?: string;
  api_key?: string;
}

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceOpenAIExtension implements InferenceExtension {
  private static readonly _homeDir = 'engines'
  private static readonly _engineMetadataFileName = 'openai.json'
  
  private _engineSettings: EngineSettings = {
    "base_url": "https://api.openai.com/v1",
    "api_key": "sk-<your key here>"
  }
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
// janroot/engine/nitro.json
  /**
   * Subscribes to events emitted by the @janhq/core package.
   */
  onLoad(): void {
    fs.mkdir(JanInferenceOpenAIExtension._homeDir)
    this.writeDefaultEngineSettings()

    // Events subscription
    events.on(EventName.OnMessageSent, (data) =>
      JanInferenceOpenAIExtension.handleMessageRequest(data, this)
    );

    events.on(EventName.OnModelInit, (data: Model) => {
      JanInferenceOpenAIExtension.handleModelInit(data);
    });

    events.on(EventName.OnModelStop, (data: Model) => {
      JanInferenceOpenAIExtension.handleModelStop(data);
    });
  }

  /**
   * Stops the model inference.
   */
  onUnload(): void {}

  /**
   * Initializes the model with the specified file name.
   * @param {string} modelId - The ID of the model to initialize.
   * @returns {Promise<void>} A promise that resolves when the model is initialized.
   */
  async initModel(
    modelId: string,
    settings?: ModelSettingParams
  ): Promise<void> {
    return
  }

  private async writeDefaultEngineSettings() {
    try {
      const engine_json = join(JanInferenceOpenAIExtension._homeDir, JanInferenceOpenAIExtension._engineMetadataFileName)
      if (await fs.checkFileExists(engine_json)) {
        this._engineSettings = JSON.parse(await fs.readFile(engine_json))
      }
      else {
        await fs.writeFile(engine_json, JSON.stringify(this._engineSettings, null, 2))
      }
    } catch (err) {
      console.error(err)
    }
  }
  /**
   * Stops the model.
   * @returns {Promise<void>} A promise that resolves when the model is stopped.
   */
  async stopModel(): Promise<void> {}

  /**
   * Stops streaming inference.
   * @returns {Promise<void>} A promise that resolves when the streaming is stopped.
   */
  async stopInference(): Promise<void> {
    this.isCancelled = true;
    this.controller?.abort();
  }

  /**
   * Makes a single response inference request.
   * @param {MessageRequest} data - The data for the inference request.
   * @returns {Promise<any>} A promise that resolves with the inference response.
   */
  async inferenceRequest(data: MessageRequest): Promise<ThreadMessage> {
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
      requestInference(data.messages ?? []).subscribe({
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

  private static async handleModelInit(data: Model) {
    console.log('Model init success', data)
    // Add filter data engine = openai
    if (data.engine !== 'openai') { return }
    // If model success
    events.emit(EventName.OnModelReady, {modelId: data.id})
    // If model failed
    // events.emit(EventName.OnModelFail, {modelId: data.id})
  }

  private static async handleModelStop(data: Model) {
    // Add filter data engine = openai
    if (data.engine !== 'openai') { return }
    events.emit(EventName.OnModelStop, {modelId: data.id})
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

    requestInference(data.messages, instance.controller).subscribe({
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
        message.status = MessageStatus.Ready;
        events.emit(EventName.OnMessageUpdate, message);
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
        events.emit(EventName.OnMessageUpdate, message);
      },
    });
  }
}
