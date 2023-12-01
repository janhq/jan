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
  fs
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
export default class JanInferenceExtension implements InferenceExtension {
  private static readonly _homeDir = 'engines'
  private static readonly _engineMetadataFileName = 'openai.json'
  
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
    fs.mkdir(JanInferenceExtension._homeDir)
    // TODO: Copy nitro.json to janroot/engine/nitro.json
    events.on(EventName.OnMessageSent, (data) =>
      JanInferenceExtension.handleMessageRequest(data, this)
    );
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
    const userSpacePath = await getUserSpace();
    const modelFullPath = join(userSpacePath, "models", modelId, modelId);

    return executeOnMain(MODULE, "initModel", {
      modelFullPath,
      settings,
    });
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

  private async copyModelsToHomeDir() {
    try {
    // list all of the files under the home directory
    const files = await fs.listFiles('')
    
    if (files.includes(JanInferenceExtension._homeDir)) {
      // ignore if the model is already downloaded
      console.debug('Model already downloaded')
    return
    }
    
    // copy models folder from resources to home directory
    const resourePath = await getResourcePath()
    const srcPath = join(resourePath, 'models')
    
    const userSpace = await getUserSpace()
    const destPath = join(userSpace, JanInferenceExtension._homeDir)
    
    await fs.copyFile(srcPath, destPath)
    } catch (err) {
      console.error(err)
    }
    }

  /**
   * Makes a single response inference request.
   * @param {MessageRequest} data - The data for the inference request.
   * @returns {Promise<any>} A promise that resolves with the inference response.
   */
  async inferenceRequest(data: MessageRequest): Promise<ThreadMessage> {
    // TODO: @louis
  }

  /**
   * Handles a new message request by making an inference request and emitting events.
   * Function registered in event manager, should be static to avoid binding issues.
   * Pass instance as a reference.
   * @param {MessageRequest} data - The data for the new message request.
   */
  private static async handleMessageRequest(
    data: MessageRequest,
    instance: JanInferenceExtension
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
    console.log(JSON.stringify(data, null, 2));

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
