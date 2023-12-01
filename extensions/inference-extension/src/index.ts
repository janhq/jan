/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-extension/src/index
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
  controller = new AbortController();
  isCancelled = false;
  /**
   * Returns the type of the extension.
   * @returns {ExtensionType} The type of the extension.
   */
  type(): ExtensionType {
    return ExtensionType.Inference;
  }

  /**
   * Subscribes to events emitted by the @janhq/core package.
   */
  onLoad(): void {
    events.on(EventName.OnMessageSent, (data) =>
      JanInferenceExtension.handleMessageRequest(data, this)
    );
  }

  /**
   * Stops the model inference.
   */
  onUnload(): void {
    this.stopModel();
  }

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
  async stopModel(): Promise<void> {
    return executeOnMain(MODULE, "killSubprocess");
  }

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
