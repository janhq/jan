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
  MessageRequest,
  MessageRequestType,
  MessageStatus,
  ThreadContent,
  ThreadMessage,
  events,
  executeOnMain,
  fs,
  Model,
  joinPath,
  InferenceExtension,
  log,
  InferenceEngine,
  MessageEvent,
  ModelEvent,
  InferenceEvent,
  ModelSettingParams,
  getJanDataFolderPath,
} from '@janhq/core'
import { requestInference } from './helpers/sse'
import { ulid } from 'ulid'

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceNitroExtension extends InferenceExtension {
  private static readonly _homeDir = 'file://engines'
  private static readonly _settingsDir = 'file://settings'
  private static readonly _engineMetadataFileName = 'nitro.json'

  /**
   * Checking the health for Nitro's process each 5 secs.
   */
  private static readonly _intervalHealthCheck = 5 * 1000

  private _currentModel: Model | undefined

  private _engineSettings: ModelSettingParams = {
    ctx_len: 2048,
    ngl: 100,
    cpu_threads: 1,
    cont_batching: false,
    embedding: true,
  }

  controller = new AbortController()
  isCancelled = false

  /**
   * The interval id for the health check. Used to stop the health check.
   */
  private getNitroProcesHealthIntervalId: NodeJS.Timeout | undefined = undefined

  /**
   * Tracking the current state of nitro process.
   */
  private nitroProcessInfo: any = undefined

  private inferenceUrl = ''

  /**
   * Subscribes to events emitted by the @janhq/core package.
   */
  async onLoad() {
    if (!(await fs.existsSync(JanInferenceNitroExtension._homeDir))) {
      try {
        await fs.mkdirSync(JanInferenceNitroExtension._homeDir)
      } catch (e) {
        console.debug(e)
      }
    }

    // init inference url
    // @ts-ignore
    const electronApi = window?.electronAPI
    this.inferenceUrl = INFERENCE_URL
    if (!electronApi) {
      this.inferenceUrl = `${window.core?.api?.baseApiUrl}/v1/chat/completions`
    }
    console.debug('Inference url: ', this.inferenceUrl)

    if (!(await fs.existsSync(JanInferenceNitroExtension._settingsDir)))
      await fs.mkdirSync(JanInferenceNitroExtension._settingsDir)
    this.writeDefaultEngineSettings()

    // Events subscription
    events.on(MessageEvent.OnMessageSent, (data: MessageRequest) =>
      this.onMessageRequest(data)
    )

    events.on(ModelEvent.OnModelInit, (model: Model) => this.onModelInit(model))

    events.on(ModelEvent.OnModelStop, (model: Model) => this.onModelStop(model))

    events.on(InferenceEvent.OnInferenceStopped, () =>
      this.onInferenceStopped()
    )

    // Attempt to fetch nvidia info
    await executeOnMain(NODE, 'updateNvidiaInfo', {})
  }

  /**
   * Stops the model inference.
   */
  onUnload(): void {}

  private async writeDefaultEngineSettings() {
    try {
      const engineFile = await joinPath([
        JanInferenceNitroExtension._homeDir,
        JanInferenceNitroExtension._engineMetadataFileName,
      ])
      if (await fs.existsSync(engineFile)) {
        const engine = await fs.readFileSync(engineFile, 'utf-8')
        this._engineSettings =
          typeof engine === 'object' ? engine : JSON.parse(engine)
      } else {
        await fs.writeFileSync(
          engineFile,
          JSON.stringify(this._engineSettings, null, 2)
        )
      }
    } catch (err) {
      console.error(err)
    }
  }

  private async onModelInit(model: Model) {
    if (model.engine !== InferenceEngine.nitro) return

    const modelFolder = await joinPath([
      await getJanDataFolderPath(),
      'models',
      model.id,
    ])
    this._currentModel = model
    const nitroInitResult = await executeOnMain(NODE, 'runModel', {
      modelFolder,
      model,
    })

    if (nitroInitResult?.error) {
      events.emit(ModelEvent.OnModelFail, {
        ...model,
        error: nitroInitResult.error,
      })
      return
    }

    events.emit(ModelEvent.OnModelReady, model)

    this.getNitroProcesHealthIntervalId = setInterval(
      () => this.periodicallyGetNitroHealth(),
      JanInferenceNitroExtension._intervalHealthCheck
    )
  }

  private async onModelStop(model: Model) {
    if (model.engine !== 'nitro') return

    await executeOnMain(NODE, 'stopModel')
    events.emit(ModelEvent.OnModelStopped, {})

    // stop the periocally health check
    if (this.getNitroProcesHealthIntervalId) {
      clearInterval(this.getNitroProcesHealthIntervalId)
      this.getNitroProcesHealthIntervalId = undefined
    }
  }

  /**
   * Periodically check for nitro process's health.
   */
  private async periodicallyGetNitroHealth(): Promise<void> {
    const health = await executeOnMain(NODE, 'getCurrentNitroProcessInfo')

    const isRunning = this.nitroProcessInfo?.isRunning ?? false
    if (isRunning && health.isRunning === false) {
      console.debug('Nitro process is stopped')
      events.emit(ModelEvent.OnModelStopped, {})
    }
    this.nitroProcessInfo = health
  }

  private async onInferenceStopped() {
    this.isCancelled = true
    this.controller?.abort()
  }

  /**
   * Makes a single response inference request.
   * @param {MessageRequest} data - The data for the inference request.
   * @returns {Promise<any>} A promise that resolves with the inference response.
   */
  async inference(data: MessageRequest): Promise<ThreadMessage> {
    const timestamp = Date.now()
    const message: ThreadMessage = {
      thread_id: data.threadId,
      created: timestamp,
      updated: timestamp,
      status: MessageStatus.Ready,
      id: '',
      role: ChatCompletionRole.Assistant,
      object: 'thread.message',
      content: [],
    }

    return new Promise(async (resolve, reject) => {
      if (!this._currentModel) return Promise.reject('No model loaded')

      requestInference(
        this.inferenceUrl,
        data.messages ?? [],
        this._currentModel
      ).subscribe({
        next: (_content: any) => {},
        complete: async () => {
          resolve(message)
        },
        error: async (err: any) => {
          reject(err)
        },
      })
    })
  }

  /**
   * Handles a new message request by making an inference request and emitting events.
   * Function registered in event manager, should be static to avoid binding issues.
   * Pass instance as a reference.
   * @param {MessageRequest} data - The data for the new message request.
   */
  private async onMessageRequest(data: MessageRequest) {
    if (data.model?.engine !== InferenceEngine.nitro || !this._currentModel) {
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

    this.isCancelled = false
    this.controller = new AbortController()

    // @ts-ignore
    const model: Model = {
      ...(this._currentModel || {}),
      ...(data.model || {}),
    }
    requestInference(
      this.inferenceUrl,
      data.messages ?? [],
      model,
      this.controller
    ).subscribe({
      next: (content: any) => {
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
      error: async (err: any) => {
        if (this.isCancelled || message.content.length) {
          message.status = MessageStatus.Stopped
          events.emit(MessageEvent.OnMessageUpdate, message)
          return
        }
        message.status = MessageStatus.Error
        events.emit(MessageEvent.OnMessageUpdate, message)
        log(`[APP]::Error: ${err.message}`)
      },
    })
  }
}
