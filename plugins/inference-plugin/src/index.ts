/**
 * @file This file exports a class that implements the InferencePlugin interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-plugin/src/index
 */

import {
  EventName,
  MessageHistory,
  NewMessageRequest,
  PluginType,
  events,
  executeOnMain,
} from "@janhq/core";
import { InferencePlugin } from "@janhq/core/lib/plugins";
import { requestInference } from "./helpers/sse";

/**
 * A class that implements the InferencePlugin interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferencePlugin implements InferencePlugin {
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
   * @param {string} modelFileName - The name of the model file.
   * @returns {Promise<void>} A promise that resolves when the model is initialized.
   */
  initModel(modelFileName: string): Promise<void> {
    return executeOnMain(MODULE, "initModel", modelFileName);
  }

  /**
   * Stops the model.
   * @returns {Promise<void>} A promise that resolves when the model is stopped.
   */
  stopModel(): Promise<void> {
    return executeOnMain(MODULE, "killSubprocess");
  }

  /**
   * Makes a single response inference request.
   * @param {NewMessageRequest} data - The data for the inference request.
   * @returns {Promise<any>} A promise that resolves with the inference response.
   */
  async inferenceRequest(data: NewMessageRequest): Promise<any> {
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

  /**
   * Handles a new message request by making an inference request and emitting events.
   * @param {NewMessageRequest} data - The data for the new message request.
   */
  private async handleMessageRequest(data: NewMessageRequest) {
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
    events.emit(EventName.OnNewMessageResponse, message);

    requestInference(recentMessages).subscribe({
      next: (content) => {
        message.message = content;
        events.emit(EventName.OnMessageResponseUpdate, message);
      },
      complete: async () => {
        message.message = message.message.trim();
        events.emit(EventName.OnMessageResponseFinished, message);
      },
      error: async (err) => {
        message.message =
          message.message.trim() + "\n" + "Error occurred: " + err.message;
        events.emit(EventName.OnMessageResponseUpdate, message);
      },
    });
  }
}
