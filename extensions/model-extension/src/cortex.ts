import PQueue from 'p-queue'
import ky from 'ky'
import {
  DownloadEvent,
  events,
  Model,
  ModelEvent,
  ModelRuntimeParams,
  ModelSettingParams,
} from '@janhq/core'
/**
 * cortex.cpp Model APIs interface
 */
interface ICortexAPI {
  getModel(model: string): Promise<Model>
  getModels(): Promise<Model[]>
  pullModel(model: string, id?: string): Promise<void>
  importModel(path: string, modelPath: string): Promise<void>
  deleteModel(model: string): Promise<void>
  updateModel(model: object): Promise<void>
  cancelModelPull(model: string): Promise<void>
}

type ModelList = {
  data: any[]
}

enum DownloadTypes {
  DownloadUpdated = 'onFileDownloadUpdate',
  DownloadError = 'onFileDownloadError',
  DownloadSuccess = 'onFileDownloadSuccess',
  DownloadStopped = 'onFileDownloadStopped',
  DownloadStarted = 'onFileDownloadStarted',
}

export class CortexAPI implements ICortexAPI {
  queue = new PQueue({ concurrency: 1 })
  socket?: WebSocket = undefined

  constructor() {
    this.queue.add(() => this.healthz())
    this.subscribeToEvents()
  }

  /**
   * Fetches a model detail from cortex.cpp
   * @param model
   * @returns
   */
  getModel(model: string): Promise<any> {
    return this.queue.add(() =>
      ky
        .get(`${API_URL}/v1/models/${model}`)
        .json()
        .then((e) => this.transformModel(e))
    )
  }

  /**
   * Fetches models list from cortex.cpp
   * @param model
   * @returns
   */
  getModels(): Promise<Model[]> {
    return this.queue
      .add(() => ky.get(`${API_URL}/models`).json<ModelList>())
      .then((e) =>
        typeof e === 'object' ? e.data.map((e) => this.transformModel(e)) : []
      )
  }

  /**
   * Pulls a model from HuggingFace via cortex.cpp
   * @param model
   * @returns
   */
  pullModel(model: string, id?: string): Promise<void> {
    return this.queue.add(() =>
      ky
        .post(`${API_URL}/v1/models/pull`, { json: { model, id } })
        .json()
        .catch(async (e) => {
          throw (await e.response?.json()) ?? e
        })
        .then()
    )
  }

  /**
   * Imports a model from a local path via cortex.cpp
   * @param model
   * @returns
   */
  importModel(model: string, modelPath: string): Promise<void> {
    return this.queue.add(() =>
      ky
        .post(`${API_URL}/v1/models/import`, { json: { model, modelPath } })
        .json()
        .catch((e) => console.debug(e)) // Ignore error
        .then()
    )
  }

  /**
   * Deletes a model from cortex.cpp
   * @param model
   * @returns
   */
  deleteModel(model: string): Promise<void> {
    return this.queue.add(() =>
      ky.delete(`${API_URL}/models/${model}`).json().then()
    )
  }

  /**
   * Update a model in cortex.cpp
   * @param model
   * @returns
   */
  updateModel(model: object): Promise<void> {
    return this.queue.add(() =>
      ky
        .patch(`${API_URL}/v1/models/${model}`, { json: { model } })
        .json()
        .then()
    )
  }

  /**
   * Cancel model pull in cortex.cpp
   * @param model
   * @returns
   */
  cancelModelPull(model: string): Promise<void> {
    return this.queue.add(() =>
      ky
        .delete(`${API_URL}/models/pull`, { json: { taskId: model } })
        .json()
        .then()
    )
  }

  /**
   * Do health check on cortex.cpp
   * @returns
   */
  healthz(): Promise<void> {
    return ky
      .get(`${API_URL}/healthz`, {
        retry: {
          limit: 10,
          methods: ['get'],
        },
      })
      .then(() => {})
  }

  /**
   * Subscribe to cortex.cpp websocket events
   */
  subscribeToEvents() {
    this.queue.add(
      () =>
        new Promise<void>((resolve) => {
          this.socket = new WebSocket(`${SOCKET_URL}/events`)

          this.socket.addEventListener('message', (event) => {
            const data = JSON.parse(event.data)
            const transferred = data.task.items.reduce(
              (acc, cur) => acc + cur.downloadedBytes,
              0
            )
            const total = data.task.items.reduce(
              (acc, cur) => acc + cur.bytes,
              0
            )
            const percent = (transferred / total || 0) * 100

            events.emit(DownloadTypes[data.type], {
              modelId: data.task.id,
              percent: percent,
              size: {
                transferred: transferred,
                total: total,
              },
            })
            // Update models list from Hub
            if (data.type === DownloadTypes.DownloadSuccess) {
              // Delay for the state update from cortex.cpp
              // Just to be sure
              setTimeout(() => {
                events.emit(ModelEvent.OnModelsUpdate, {})
              }, 500)
            }
          })
          resolve()
        })
    )
  }

  /**
   * TRansform model to the expected format (e.g. parameters, settings, metadata)
   * @param model
   * @returns
   */
  private transformModel(model: any) {
    model.parameters = setParameters<ModelRuntimeParams>(model)
    model.settings = setParameters<ModelSettingParams>(model)
    model.metadata = {
      tags: [],
    }
    return model as Model
  }
}

type FilteredParams<T> = {
  [K in keyof T]: T[K]
}

function setParameters<T>(params: T): T {
  const filteredParams: FilteredParams<T> = { ...params }
  return filteredParams
}
