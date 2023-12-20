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

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceNitroExtension implements InferenceExtension {
  private static readonly _homeDir = "engines";
  private static readonly _engineMetadataFileName = "nitro.json";

  private static _currentModel: Model;

  private static _engineSettings: EngineSettings = {
    ctx_len: 2048,
    ngl: 100,
    cpu_threads: 1,
    cont_batching: false,
    embedding: false,
  };

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
    fs.mkdir(JanInferenceNitroExtension._homeDir);
    this.writeDefaultEngineSettings();

    // Events subscription
    events.on(EventName.OnMessageSent, (data) =>
      JanInferenceNitroExtension.handleMessageRequest(data, this)
    );

    events.on(EventName.OnModelInit, (model: Model) => {
      JanInferenceNitroExtension.handleModelInit(model);
    });

    events.on(EventName.OnModelStop, (model: Model) => {
      JanInferenceNitroExtension.handleModelStop(model);
    });

    events.on(EventName.OnInferenceStopped, () => {
      JanInferenceNitroExtension.handleInferenceStopped(this);
    });
  }

  /**
   * Stops the model inference.
   */
  onUnload(): void {}

  private async writeDefaultEngineSettings() {
    try {
      const engineFile = join(
        JanInferenceNitroExtension._homeDir,
        JanInferenceNitroExtension._engineMetadataFileName
      );
      if (await fs.exists(engineFile)) {
        JanInferenceNitroExtension._engineSettings = JSON.parse(
          await fs.readFile(engineFile)
        );
      } else {
        await fs.writeFile(
          engineFile,
          JSON.stringify(JanInferenceNitroExtension._engineSettings, null, 2)
        );
      }
    } catch (err) {
      console.error(err);
    }
  }

  private static async handleModelInit(model: Model) {
    if (model.engine !== "nitro") {
      return;
    }
    const userSpacePath = await getUserSpace();
    const modelFullPath = join(userSpacePath, "models", model.id, model.id);

    const nitroInitResult = await executeOnMain(MODULE, "initModel", {
      modelFullPath: modelFullPath,
      model: model,
    });

    if (nitroInitResult.error === null) {
      events.emit(EventName.OnModelFail, model);
    } else {
      JanInferenceNitroExtension._currentModel = model;
      events.emit(EventName.OnModelReady, model);
    }
  }

  private static async handleModelStop(model: Model) {
    if (model.engine !== "nitro") {
      return;
    } else {
      await executeOnMain(MODULE, "stopModel");
      events.emit(EventName.OnModelStopped, model);
    }
  }

  private static async handleInferenceStopped(
    instance: JanInferenceNitroExtension
  ) {
    instance.isCancelled = true;
    instance.controller?.abort();
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
        JanInferenceNitroExtension._currentModel
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

  /**
   * Handles a new message request by making an inference request and emitting events.
   * Function registered in event manager, should be static to avoid binding issues.
   * Pass instance as a reference.
   * @param {MessageRequest} data - The data for the new message request.
   */
  private static async handleMessageRequest(
    data: MessageRequest,
    instance: JanInferenceNitroExtension
  ) {
    if (data.model.engine !== "nitro") {
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
      data.messages ?? [],
      { ...JanInferenceNitroExtension._currentModel, ...data.model },
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
        if (instance.isCancelled || message.content.length > 0) {
          message.status = MessageStatus.Ready;
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
