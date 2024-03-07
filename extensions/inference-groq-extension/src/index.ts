/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-groq-extension/src/index
 */

import {
  ChatCompletionRole,
  ContentType,
  MessageRequest,
  MessageStatus,
  ThreadContent,
  ThreadMessage,
  events,
  fs,
  InferenceEngine,
  BaseExtension,
  MessageEvent,
  MessageRequestType,
  ModelEvent,
  InferenceEvent,
  AppConfigurationEventName,
  joinPath,
} from '@janhq/core'
import { requestInference } from './helpers/sse'
import { ulid } from 'ulid'
import { join } from 'path'

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceGroqExtension extends BaseExtension {
  private static readonly _engineDir = 'file://engines'
  private static readonly _engineMetadataFileName = 'groq.json'

  private static _currentModel: GroqModel

  private static _engineSettings: EngineSettings = {
    full_url: 'https://api.groq.com/openai/v1/chat/completions',
    api_key: 'gsk-<your key here>',
  }

  controller = new AbortController()
  isCancelled = false

  /**
   * Subscribes to events emitted by the @janhq/core package.
   */
  async onLoad() {
    if (!(await fs.existsSync(JanInferenceGroqExtension._engineDir))) {
      await fs
        .mkdirSync(JanInferenceGroqExtension._engineDir)
        .catch((err) => console.debug(err))
    }

    JanInferenceGroqExtension.writeDefaultEngineSettings()

    // Events subscription
    events.on(MessageEvent.OnMessageSent, (data) =>
      JanInferenceGroqExtension.handleMessageRequest(data, this)
    )

    events.on(ModelEvent.OnModelInit, (model: GroqModel) => {
      JanInferenceGroqExtension.handleModelInit(model)
    })

    events.on(ModelEvent.OnModelStop, (model: GroqModel) => {
      JanInferenceGroqExtension.handleModelStop(model)
    })
    events.on(InferenceEvent.OnInferenceStopped, () => {
      JanInferenceGroqExtension.handleInferenceStopped(this)
    })

    const settingsFilePath = await joinPath([
      JanInferenceGroqExtension._engineDir,
      JanInferenceGroqExtension._engineMetadataFileName,
    ])

    events.on(
      AppConfigurationEventName.OnConfigurationUpdate,
      (settingsKey: string) => {
        // Update settings on changes
        if (settingsKey === settingsFilePath)
          JanInferenceGroqExtension.writeDefaultEngineSettings()
      }
    )
  }

  /**
   * Stops the model inference.
   */
  onUnload(): void {}

  static async writeDefaultEngineSettings() {
    try {
      const engineFile = join(
        JanInferenceGroqExtension._engineDir,
        JanInferenceGroqExtension._engineMetadataFileName
      )
      if (await fs.existsSync(engineFile)) {
        const engine = await fs.readFileSync(engineFile, 'utf-8')
        JanInferenceGroqExtension._engineSettings =
          typeof engine === 'object' ? engine : JSON.parse(engine)
      } else {
        await fs.writeFileSync(
          engineFile,
          JSON.stringify(JanInferenceGroqExtension._engineSettings, null, 2)
        )
      }
    } catch (err) {
      console.error(err)
    }
  }
  private static async handleModelInit(model: GroqModel) {
    if (model.engine !== InferenceEngine.groq) {
      return
    } else {
      JanInferenceGroqExtension._currentModel = model
      JanInferenceGroqExtension.writeDefaultEngineSettings()
      // Todo: Check model list with API key
      events.emit(ModelEvent.OnModelReady, model)
    }
  }

  private static async handleModelStop(model: GroqModel) {
    if (model.engine !== 'groq') {
      return
    }
    events.emit(ModelEvent.OnModelStopped, model)
  }

  private static async handleInferenceStopped(
    instance: JanInferenceGroqExtension
  ) {
    instance.isCancelled = true
    instance.controller?.abort()
  }

  /**
   * Handles a new message request by making an inference request and emitting events.
   * Function registered in event manager, should be static to avoid binding issues.
   * Pass instance as a reference.
   * @param {MessageRequest} data - The data for the new message request.
   */
  private static async handleMessageRequest(
    data: MessageRequest,
    instance: JanInferenceGroqExtension
  ) {
    if (data.model.engine !== 'groq') {
      return
    }

    const timestamp = Date.now()
    const message: ThreadMessage = {
      id: ulid(),
      thread_id: data.threadId,
      type: data.type,
      assistant_id: data.assistantId,
      role: ChatCompletionRole.Assistant,
      content: [],
      status: MessageStatus.Pending,
      created: timestamp,
      updated: timestamp,
      object: 'thread.message',
    }

    if (data.type !== MessageRequestType.Summary) {
      events.emit(MessageEvent.OnMessageResponse, message)
    }

    instance.isCancelled = false
    instance.controller = new AbortController()

    requestInference(
      data?.messages ?? [],
      this._engineSettings,
      {
        ...JanInferenceGroqExtension._currentModel,
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
        }
        message.content = [messageContent]
        events.emit(MessageEvent.OnMessageUpdate, message)
      },
      complete: async () => {
        message.status = message.content.length
          ? MessageStatus.Ready
          : MessageStatus.Error
        events.emit(MessageEvent.OnMessageUpdate, message)
      },
      error: async (err) => {
        if (instance.isCancelled || message.content.length > 0) {
          message.status = MessageStatus.Stopped
          events.emit(MessageEvent.OnMessageUpdate, message)
          return
        }
        const messageContent: ThreadContent = {
          type: ContentType.Text,
          text: {
            value: 'An error occurred. ' + err.message,
            annotations: [],
          },
        }
        message.content = [messageContent]
        message.status = MessageStatus.Error
        message.error_code = err.code
        events.emit(MessageEvent.OnMessageUpdate, message)
      },
    })
  }
}
