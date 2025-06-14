/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-extension/src/index
 */

import {
  Model,
  EngineEvent,
  LocalOAIEngine,
  extractModelLoadParams,
  events,
  ModelEvent,
} from '@janhq/core'
import ky, { KyInstance } from 'ky'

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

enum Settings {
  n_parallel = 'n_parallel',
  cont_batching = 'cont_batching',
  caching_enabled = 'caching_enabled',
  flash_attn = 'flash_attn',
  cache_type = 'cache_type',
  use_mmap = 'use_mmap',
  cpu_threads = 'cpu_threads',
  huggingfaceToken = 'hugging-face-access-token',
  auto_unload_models = 'auto_unload_models',
  context_shift = 'context_shift',
}

type LoadedModelResponse = { data: { engine: string; id: string }[] }

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceCortexExtension extends LocalOAIEngine {
  nodeModule: string = 'node'

  provider: string = 'cortex'

  shouldReconnect = true

  /** Default Engine model load settings */
  n_parallel?: number
  cont_batching: boolean = false
  caching_enabled: boolean = true
  flash_attn: boolean = true
  use_mmap: boolean = true
  cache_type: string = 'q8'
  cpu_threads?: number
  auto_unload_models: boolean = true
  reasoning_budget = -1 // Default reasoning budget in seconds
  context_shift = true
  /**
   * The URL for making inference requests.
   */
  inferenceUrl = `${CORTEX_API_URL}/v1/chat/completions`

  /**
   * Socket instance of events subscription
   */
  socket?: WebSocket = undefined

  abortControllers = new Map<string, AbortController>()

  api?: KyInstance
  /**
   * Get the API instance
   * @returns
   */
  async apiInstance(): Promise<KyInstance> {
    if (this.api) return this.api
    const apiKey = await window.core?.api.appToken()
    this.api = ky.extend({
      prefixUrl: CORTEX_API_URL,
      headers: apiKey
        ? {
            Authorization: `Bearer ${apiKey}`,
          }
        : {},
      retry: 10,
    })
    return this.api
  }

  /**
   * Authorization headers for the API requests.
   * @returns
   */
  headers(): Promise<HeadersInit> {
    return window.core?.api.appToken().then((token: string) => ({
      Authorization: `Bearer ${token}`,
    }))
  }

  /**
   * Called when the extension is loaded.
   */
  async onLoad() {
    super.onLoad()

    // Register Settings
    this.registerSettings(SETTINGS)

    const numParallel = await this.getSetting<string>(Settings.n_parallel, '')
    if (numParallel.length > 0 && parseInt(numParallel) > 0) {
      this.n_parallel = parseInt(numParallel)
    }
    if (this.n_parallel && this.n_parallel > 1)
      this.cont_batching = await this.getSetting<boolean>(
        Settings.cont_batching,
        false
      )
    this.caching_enabled = await this.getSetting<boolean>(
      Settings.caching_enabled,
      true
    )
    this.flash_attn = await this.getSetting<boolean>(Settings.flash_attn, true)
    this.context_shift = await this.getSetting<boolean>(
      Settings.context_shift,
      true
    )
    this.use_mmap = await this.getSetting<boolean>(Settings.use_mmap, true)
    if (this.caching_enabled)
      this.cache_type = await this.getSetting<string>(Settings.cache_type, 'q8')
    this.auto_unload_models = await this.getSetting<boolean>(
      Settings.auto_unload_models,
      true
    )
    const threads_number = Number(
      await this.getSetting<string>(Settings.cpu_threads, '')
    )

    if (!Number.isNaN(threads_number)) this.cpu_threads = threads_number

    const huggingfaceToken = await this.getSetting<string>(
      Settings.huggingfaceToken,
      ''
    )
    if (huggingfaceToken) {
      this.updateCortexConfig({ huggingface_token: huggingfaceToken })
    }
    this.subscribeToEvents()

    window.addEventListener('beforeunload', () => {
      this.clean()
    })

    // Migrate configs
    if (!localStorage.getItem('cortex_migration_completed')) {
      const config = await this.getCortexConfig()
      console.log('Start cortex.cpp migration', config)
      if (config && config.huggingface_token) {
        this.updateSettings([
          {
            key: Settings.huggingfaceToken,
            controllerProps: {
              value: config.huggingface_token,
            },
          },
        ])
        this.updateCortexConfig({
          huggingface_token: config.huggingface_token,
        })
        localStorage.setItem('cortex_migration_completed', 'true')
      }
    }
  }

  async onUnload() {
    console.log('Clean up cortex.cpp services')
    this.shouldReconnect = false
    this.clean()
    super.onUnload()
  }

  /**
   * Subscribe to settings update and make change accordingly
   * @param key
   * @param value
   */
  onSettingUpdate<T>(key: string, value: T): void {
    if (key === Settings.n_parallel && typeof value === 'string') {
      if (value.length > 0 && parseInt(value) > 0) {
        this.n_parallel = parseInt(value)
      }
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
    } else if (key === Settings.cpu_threads && typeof value === 'string') {
      const threads_number = Number(value)
      if (!Number.isNaN(threads_number)) this.cpu_threads = threads_number
    } else if (key === Settings.huggingfaceToken) {
      this.updateCortexConfig({ huggingface_token: value })
    } else if (key === Settings.auto_unload_models) {
      this.auto_unload_models = value as boolean
    } else if (key === Settings.context_shift && typeof value === 'boolean') {
      this.context_shift = value
    }
  }

  override async loadModel(
    model: Partial<Model> & {
      id: string
      settings?: object
      file_path?: string
    },
    abortController: AbortController
  ): Promise<void> {
    // Cortex will handle these settings
    const { llama_model_path, mmproj, ...settings } = model.settings ?? {}
    model.settings = settings

    const controller = abortController ?? new AbortController()
    const { signal } = controller

    this.abortControllers.set(model.id, controller)

    const loadedModels = await this.activeModels()

    // This is to avoid loading the same model multiple times
    if (loadedModels.some((e: { id: string }) => e.id === model.id)) {
      console.log(`Model ${model.id} already loaded`)
      return
    }
    if (this.auto_unload_models) {
      // Unload the last used model if it is not the same as the current one
      for (const lastUsedModel of loadedModels) {
        if (lastUsedModel.id !== model.id) {
          console.log(`Unloading last used model: ${lastUsedModel.id}`)
          await this.unloadModel(lastUsedModel as Model)
        }
      }
    }
    return await this.apiInstance().then((api) =>
      api
        .post('v1/models/start', {
          json: {
            ...extractModelLoadParams(model.settings),
            model: model.id,
            engine:
              model.engine === 'nitro' // Legacy model cache
                ? 'llama-cpp'
                : model.engine,
            ...(this.n_parallel ? { n_parallel: this.n_parallel } : {}),
            ...(this.use_mmap ? { use_mmap: true } : {}),
            ...(this.caching_enabled ? { caching_enabled: true } : {}),
            ...(this.flash_attn ? { flash_attn: true } : {}),
            ...(this.caching_enabled && this.cache_type
              ? { cache_type: this.cache_type }
              : {}),
            ...(this.cpu_threads && this.cpu_threads > 0
              ? { cpu_threads: this.cpu_threads }
              : {}),
            ...(this.cont_batching && this.n_parallel && this.n_parallel > 1
              ? { cont_batching: this.cont_batching }
              : {}),
            ...(model.id.toLowerCase().includes('jan-nano')
              ? { reasoning_budget: 0 }
              : { reasoning_budget: this.reasoning_budget }),
            ...(this.context_shift === false
              ? { 'no-context-shift': true }
              : {}),
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
    return this.apiInstance().then((api) =>
      api
        .post('v1/models/stop', {
          json: { model: model.id },
          retry: {
            limit: 0,
          },
        })
        .json()
        .finally(() => {
          this.abortControllers.get(model.id)?.abort()
        })
        .then()
    )
  }

  async activeModels(): Promise<(object & { id: string })[]> {
    return await this.apiInstance()
      .then((e) =>
        e.get('inferences/server/models', {
          retry: {
            limit: 0, // Do not retry
          },
        })
      )
      .then((e) => e.json())
      .then((e) => (e as LoadedModelResponse).data ?? [])
      .catch(() => [])
  }

  /**
   * Clean cortex processes
   * @returns
   */
  private async clean(): Promise<any> {
    return this.apiInstance()
      .then((api) =>
        api.delete('processmanager/destroy', {
          timeout: 2000, // maximum 2 seconds
          retry: {
            limit: 0,
          },
        })
      )
      .catch(() => {
        // Do nothing
      })
  }

  /**
   * Update cortex config
   * @param body
   */
  private async updateCortexConfig(body: {
    [key: string]: any
  }): Promise<void> {
    return this.apiInstance()
      .then((api) => api.patch('v1/configs', { json: body }).then(() => {}))
      .catch((e) => console.debug(e))
  }

  /**
   * Get cortex config
   * @param body
   */
  private async getCortexConfig(): Promise<any> {
    return this.apiInstance()
      .then((api) => api.get('v1/configs').json())
      .catch((e) => console.debug(e))
  }

  /**
   * Subscribe to cortex.cpp websocket events
   */
  private subscribeToEvents() {
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

      events.emit(DownloadTypes[data.type as keyof typeof DownloadTypes], {
        modelId: data.task.id,
        percent: percent,
        size: {
          transferred: transferred,
          total: total,
        },
        downloadType: data.task.type,
      })

      if (data.task.type === 'Engine') {
        events.emit(EngineEvent.OnEngineUpdate, {
          type: DownloadTypes[data.type as keyof typeof DownloadTypes],
          percent: percent,
          id: data.task.id,
        })
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
      // Notify app to update model running state
      events.emit(ModelEvent.OnModelStopped, {})

      // Reconnect to the /events websocket
      if (this.shouldReconnect) {
        setTimeout(() => this.subscribeToEvents(), 1000)
      }
    }
  }
}
