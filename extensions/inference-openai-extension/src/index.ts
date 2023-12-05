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
  fs,
} from "@janhq/core";
import { InferenceExtension } from "@janhq/core";
import { requestInference } from "./helpers/sse";
import { ulid } from "ulid";
import { join } from "path";
import { EngineSettings, OpenAIModel } from "./@types/global";

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceOpenAIExtension implements InferenceExtension {
  private static readonly _homeDir = 'engines'
  private static readonly _engineMetadataFileName = 'openai.json'
  
  static _currentModel: OpenAIModel;

  static _engineSettings: EngineSettings = {
    "base_url": "https://api.openai.com/v1",
    "api_key": "sk-<your key here>"
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
    fs.mkdir(JanInferenceOpenAIExtension._homeDir)
    JanInferenceOpenAIExtension.writeDefaultEngineSettings()

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

  static async writeDefaultEngineSettings() {
    try {
      const engine_json = join(JanInferenceOpenAIExtension._homeDir, JanInferenceOpenAIExtension._engineMetadataFileName)
      if (await fs.checkFileExists(engine_json)) {
        JanInferenceOpenAIExtension._engineSettings = JSON.parse(await fs.readFile(engine_json))
      }
      else {
        await fs.writeFile(engine_json, JSON.stringify(JanInferenceOpenAIExtension._engineSettings, null, 2))
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
      requestInference(data.messages ?? [], 
          JanInferenceOpenAIExtension._engineSettings, 
          JanInferenceOpenAIExtension._currentModel)
        .subscribe({
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
    if (model.engine !== 'openai') { return }
    else {
      JanInferenceOpenAIExtension._currentModel = model
      JanInferenceOpenAIExtension.writeDefaultEngineSettings()
      // Todo: Check model list with API key
      events.emit(EventName.OnModelReady, model)
      // events.emit(EventName.OnModelFail, model)
    }
  }

  private static async handleModelStop(model: OpenAIModel) {
    if (model.engine !== 'openai') { return }
    events.emit(EventName.OnModelStopped, model)
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
    if (data.model.engine !== 'openai') { return }
    
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
      JanInferenceOpenAIExtension._currentModel,
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
