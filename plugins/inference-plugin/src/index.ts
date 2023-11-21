/**
 * @file This file exports a class that implements the InferencePlugin interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-plugin/src/index
 */

import {
  ChatCompletionRole,
  EventName,
  MessageRequest,
  MessageStatus,
  PluginType,
  ThreadMessage,
  events,
  executeOnMain,
} from "@janhq/core";
import { InferencePlugin } from "@janhq/core/lib/plugins";
import { requestInference } from "./helpers/sse";
import { ulid } from "ulid";
import { join } from "path";
import { fs } from "@janhq/core";

/**
 * A class that implements the InferencePlugin interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferencePlugin implements InferencePlugin {
  controller = new AbortController();
  /**
   * Returns the type of the plugin.
   * @returns {PluginType} The type of the plugin.
   */
  type(): PluginType {
    return PluginType.Inference;
  }

  /**
   * Subscribes to events emitted by the @janhq/core package.
   */
  onLoad(): void {
    events.on(EventName.OnNewMessageRequest, this.handleMessageRequest);
  }

  /**
   * Stops the model inference.
   */
  onUnload(): void {
    this.stopModel();
  }

  /**
   * Initializes the model with the specified file name.
   * @param {string} modelFileName - The file name of the model file.
   * @returns {Promise<void>} A promise that resolves when the model is initialized.
   */
  async initModel(modelFileName: string): Promise<void> {
    const userSpacePath = await fs.getUserSpace();
    const modelFullPath = join(userSpacePath, modelFileName);

    return executeOnMain(MODULE, "initModel", modelFullPath);
  }

  /**
   * Stops the model.
   * @returns {Promise<void>} A promise that resolves when the model is stopped.
   */
  async stopModel(): Promise<void> {
    return executeOnMain(MODULE, "killSubprocess");
  }

  /**
   * Stops streaming inference.
   * @returns {Promise<void>} A promise that resolves when the streaming is stopped.
   */
  async stopInference(): Promise<void> {
    this.controller.abort();
  }

  /**
   * Makes a single response inference request.
   * @param {MessageRequest} data - The data for the inference request.
   * @returns {Promise<any>} A promise that resolves with the inference response.
   */
  async inferenceRequest(data: MessageRequest): Promise<ThreadMessage> {
    const message: ThreadMessage = {
      threadId: data.threadId,
      content: "",
      createdAt: new Date().toISOString(),
      status: MessageStatus.Ready,
    };

    return new Promise(async (resolve, reject) => {
      requestInference(data.messages ?? []).subscribe({
        next: (content) => {
          message.content = content;
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

  /**
   * Handles a new message request by making an inference request and emitting events.
   * @param {MessageRequest} data - The data for the new message request.
   */
  private async handleMessageRequest(data: MessageRequest) {
    const message: ThreadMessage = {
      threadId: data.threadId,
      content: "",
      role: ChatCompletionRole.Assistant,
      createdAt: new Date().toISOString(),
      id: ulid(),
      status: MessageStatus.Pending,
    };
    events.emit(EventName.OnNewMessageResponse, message);

    this.controller = new AbortController();

    requestInference(data.messages, this.controller).subscribe({
      next: (content) => {
        message.content = content;
        events.emit(EventName.OnMessageResponseUpdate, message);
      },
      complete: async () => {
        message.content = message.content.trim();
        message.status = MessageStatus.Ready;
        events.emit(EventName.OnMessageResponseFinished, message);
      },
      error: async (err) => {
        message.content =
          message.content.trim() + "\n" + "Error occurred: " + err.message;
        message.status = MessageStatus.Ready;
        events.emit(EventName.OnMessageResponseUpdate, message);
      },
    });
  }
}
