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
  systemInformation,
  joinPath,
  LocalOAIEngine,
  InferenceEngine,
  getJanDataFolderPath,
  extractModelLoadParams,
  fs,
  events,
  ModelEvent,
  SystemInformation,
  dirName,
  AppConfigurationEventName,
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

  /**
   * The URL for making inference requests.
   */
  inferenceUrl = `${CORTEX_API_URL}/v1/chat/completions`

  /**
   * Socket instance of events subscription
   */
  socket?: WebSocket = undefined

  /**
   * Subscribes to events emitted by the @janhq/core package.
   */
  async onLoad() {
    const models = MODELS as Model[]

    this.registerModels(models)

    super.onLoad()

    this.queue.add(() => this.clean())

    // Run the process watchdog
    const systemInfo = await systemInformation()
    this.queue.add(() => executeOnMain(NODE, 'run', systemInfo))
    this.queue.add(() => this.healthz())
    this.queue.add(() => this.setDefaultEngine(systemInfo))
    this.subscribeToEvents()

    window.addEventListener('beforeunload', () => {
      this.clean()
    })

    const currentMode = systemInfo.gpuSetting?.run_mode

    events.on(AppConfigurationEventName.OnConfigurationUpdate, async () => {
      const systemInfo = await systemInformation()
      // Update run mode on settings update
      if (systemInfo.gpuSetting?.run_mode !== currentMode)
        this.queue.add(() => this.setDefaultEngine(systemInfo))
    })
  }

  async onUnload() {
    console.log('Clean up cortex.cpp services')
    this.shouldReconnect = false
    this.clean()
    await executeOnMain(NODE, 'dispose')
    super.onUnload()
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
          },
          timeout: false,
        })
        .json()
        .catch(async (e) => {
          throw (await e.response?.json()) ?? e
        })
        .then()
    )
  }

  override async unloadModel(model: Model): Promise<void> {
    return ky
      .post(`${CORTEX_API_URL}/v1/models/stop`, {
        json: { model: model.id },
      })
      .json()
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
   * Set default engine variant on launch
   */
  private async setDefaultEngine(systemInfo: SystemInformation) {
    const variant = await executeOnMain(
      NODE,
      'engineVariant',
      systemInfo.gpuSetting
    )
    return ky
      .post(
        `${CORTEX_API_URL}/v1/engines/${InferenceEngine.cortex_llamacpp}/default?version=${CORTEX_ENGINE_VERSION}&variant=${variant}`,
        { json: {} }
      )
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
              }
            )
            // Update models list from Hub
            if (data.type === DownloadTypes.DownloadSuccess) {
              // Delay for the state update from cortex.cpp
              // Just to be sure
              setTimeout(() => {
                events.emit(ModelEvent.OnModelsUpdate, {
                  fetch: true,
                })
              }, 500)
            }
          })

          this.socket.onclose = (event) => {
            console.log('WebSocket closed:', event)
            if (this.shouldReconnect) {
              console.log(`Attempting to reconnect...`)
              setTimeout(() => this.subscribeToEvents(), 1000)
            }
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
