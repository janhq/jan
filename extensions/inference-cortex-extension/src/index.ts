/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-extension/src/index
 */

import {
  Model,
  executeOnMain,
  EngineEvent,
  systemInformation,
  joinPath,
  LocalOAIEngine,
  InferenceEngine,
  getJanDataFolderPath,
  extractModelLoadParams,
  fs,
  events,
  ModelEvent,
  dirName,
} from '@janhq/core'
import PQueue from 'p-queue'
import ky from 'ky'

/**
 * Event subscription types of Downloader
 */
enum DownloadTypes {
  DownloadUpdated = 'onFileDownloadUpdate',
  DownloadError = 'onFileDownloadError',
  DownloadSuccess = 'onFileDownloadSuccess',
  DownloadStopped = 'onFileDownloadStopped',
  DownloadStarted = 'onFileDownloadStarted',
}

export enum Settings {
  n_parallel = 'n_parallel',
  cont_batching = 'cont_batching',
  caching_enabled = 'caching_enabled',
  flash_attn = 'flash_attn',
  cache_type = 'cache_type',
  use_mmap = 'use_mmap',
}

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceCortexExtension extends LocalOAIEngine {
  nodeModule: string = 'node'

  queue = new PQueue({ concurrency: 1 })

  provider: string = InferenceEngine.cortex

  shouldReconnect = true

  /** Default Engine model load settings */
  n_parallel: number = 4
  cont_batching: boolean = true
  caching_enabled: boolean = true
  flash_attn: boolean = true
  use_mmap: boolean = true
  cache_type: string = 'f16'

  /**
   * The URL for making inference requests.
   */
  inferenceUrl = `${CORTEX_API_URL}/v1/chat/completions`

  /**
   * Socket instance of events subscription
   */
  socket?: WebSocket = undefined

  abortControllers = new Map<string, AbortController>()

  /**
   * Subscribes to events emitted by the @janhq/core package.
   */
  async onLoad() {
    const models = MODELS as Model[]

    this.registerModels(models)

    super.onLoad()

    // Register Settings
    this.registerSettings(SETTINGS)

    this.n_parallel =
      Number(await this.getSetting<string>(Settings.n_parallel, '4')) ?? 4
    this.cont_batching = await this.getSetting<boolean>(
      Settings.cont_batching,
      true
    )
    this.caching_enabled = await this.getSetting<boolean>(
      Settings.caching_enabled,
      true
    )
    this.flash_attn = await this.getSetting<boolean>(Settings.flash_attn, true)
    this.use_mmap = await this.getSetting<boolean>(Settings.use_mmap, true)
    this.cache_type = await this.getSetting<string>(Settings.cache_type, 'f16')

    this.queue.add(() => this.clean())

    // Run the process watchdog
    const systemInfo = await systemInformation()
    this.queue.add(() => executeOnMain(NODE, 'run', systemInfo))
    this.queue.add(() => this.healthz())
    this.subscribeToEvents()

    window.addEventListener('beforeunload', () => {
      this.clean()
    })
  }

  async onUnload() {
    console.log('Clean up cortex.cpp services')
    this.shouldReconnect = false
    this.clean()
    await executeOnMain(NODE, 'dispose')
    super.onUnload()
  }

  onSettingUpdate<T>(key: string, value: T): void {
    if (key === Settings.n_parallel && typeof value === 'string') {
      this.n_parallel = Number(value) ?? 1
    } else if (key === Settings.cont_batching && typeof value === 'boolean') {
      this.cont_batching = value as boolean
    } else if (key === Settings.caching_enabled && typeof value === 'boolean') {
      this.caching_enabled = value as boolean
    } else if (key === Settings.flash_attn && typeof value === 'boolean') {
      this.flash_attn = value as boolean
    } else if (key === Settings.cache_type && typeof value === 'string') {
      this.cache_type = value as string
    } else if (key === Settings.use_mmap && typeof value === 'boolean') {
      this.use_mmap = value as boolean
    }
  }

  override async loadModel(
    model: Model & { file_path?: string }
  ): Promise<void> {
    if (
      (model.engine === InferenceEngine.nitro || model.settings.vision_model) &&
      model.settings.llama_model_path
    ) {
      // Legacy chat model support
      model.settings = {
        ...model.settings,
        llama_model_path: await getModelFilePath(
          model,
          model.settings.llama_model_path
        ),
      }
    } else {
      const { llama_model_path, ...settings } = model.settings
      model.settings = settings
    }

    if (
      (model.engine === InferenceEngine.nitro || model.settings.vision_model) &&
      model.settings.mmproj
    ) {
      // Legacy clip vision model support
      model.settings = {
        ...model.settings,
        mmproj: await getModelFilePath(model, model.settings.mmproj),
      }
    } else {
      const { mmproj, ...settings } = model.settings
      model.settings = settings
    }
    const controller = new AbortController()
    const { signal } = controller

    this.abortControllers.set(model.id, controller)

    return await this.queue.add(() =>
      ky
        .post(`${CORTEX_API_URL}/v1/models/start`, {
          json: {
            ...extractModelLoadParams(model.settings),
            model: model.id,
            engine:
              model.engine === InferenceEngine.nitro // Legacy model cache
                ? InferenceEngine.cortex_llamacpp
                : model.engine,
            cont_batching: this.cont_batching,
            n_parallel: this.n_parallel,
            caching_enabled: this.caching_enabled,
            flash_attn: this.flash_attn,
            cache_type: this.cache_type,
            use_mmap: this.use_mmap,
          },
          timeout: false,
          signal,
        })
        .json()
        .catch(async (e) => {
          throw (await e.response?.json()) ?? e
        })
        .finally(() => this.abortControllers.delete(model.id))
        .then()
    )
  }

  override async unloadModel(model: Model): Promise<void> {
    return ky
      .post(`${CORTEX_API_URL}/v1/models/stop`, {
        json: { model: model.id },
      })
      .json()
      .finally(() => {
        this.abortControllers.get(model.id)?.abort()
      })
      .then()
  }

  /**
   * Do health check on cortex.cpp
   * @returns
   */
  private healthz(): Promise<void> {
    return ky
      .get(`${CORTEX_API_URL}/healthz`, {
        retry: {
          limit: 20,
          delay: () => 500,
          methods: ['get'],
        },
      })
      .then(() => {})
  }

  /**
   * Clean cortex processes
   * @returns
   */
  private clean(): Promise<any> {
    return ky
      .delete(`${CORTEX_API_URL}/processmanager/destroy`, {
        timeout: 2000, // maximum 2 seconds
        retry: {
          limit: 0,
        },
      })
      .catch(() => {
        // Do nothing
      })
  }

  /**
   * Subscribe to cortex.cpp websocket events
   */
  private subscribeToEvents() {
    this.queue.add(
      () =>
        new Promise<void>((resolve) => {
          this.socket = new WebSocket(`${CORTEX_SOCKET_URL}/events`)

          this.socket.addEventListener('message', (event) => {
            const data = JSON.parse(event.data)
            const transferred = data.task.items.reduce(
              (acc: number, cur: any) => acc + cur.downloadedBytes,
              0
            )
            const total = data.task.items.reduce(
              (acc: number, cur: any) => acc + cur.bytes,
              0
            )
            const percent = total > 0 ? transferred / total : 0

            events.emit(
              DownloadTypes[data.type as keyof typeof DownloadTypes],
              {
                modelId: data.task.id,
                percent: percent,
                size: {
                  transferred: transferred,
                  total: total,
                },
                downloadType: data.task.type,
              }
            )

            if (data.task.type === 'Engine') {
              events.emit(EngineEvent.OnEngineUpdate, {})
            } else {
              if (data.type === DownloadTypes.DownloadSuccess) {
                // Delay for the state update from cortex.cpp
                // Just to be sure
                setTimeout(() => {
                  events.emit(ModelEvent.OnModelsUpdate, {
                    fetch: true,
                  })
                }, 500)
              }
            }
          })

          /**
           * This is to handle the server segfault issue
           */
          this.socket.onclose = (event) => {
            console.log('WebSocket closed:', event)
            // Notify app to update model running state
            events.emit(ModelEvent.OnModelStopped, {})

            // Reconnect to the /events websocket
            if (this.shouldReconnect) {
              console.log(`Attempting to reconnect...`)
              setTimeout(() => this.subscribeToEvents(), 1000)
            }

            // Queue up health check
            this.queue.add(() => this.healthz())
          }

          resolve()
        })
    )
  }
}

/// Legacy
const getModelFilePath = async (
  model: Model & { file_path?: string },
  file: string
): Promise<string> => {
  // Symlink to the model file
  if (
    !model.sources[0]?.url.startsWith('http') &&
    (await fs.existsSync(model.sources[0].url))
  ) {
    return model.sources[0]?.url
  }
  if (model.file_path) {
    await joinPath([await dirName(model.file_path), file])
  }
  return joinPath([await getJanDataFolderPath(), 'models', model.id, file])
}
///
