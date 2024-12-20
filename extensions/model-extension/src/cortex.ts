import PQueue from 'p-queue'
import ky from 'ky'
import { extractModelLoadParams, Model } from '@janhq/core'
import { extractInferenceParams } from '@janhq/core'
/**
 * cortex.cpp Model APIs interface
 */
interface ICortexAPI {
  getModel(model: string): Promise<Model>
  getModels(): Promise<Model[]>
  pullModel(model: string, id?: string, name?: string): Promise<void>
  importModel(
    path: string,
    modelPath: string,
    name?: string,
    option?: string
  ): Promise<void>
  deleteModel(model: string): Promise<void>
  updateModel(model: object): Promise<void>
  cancelModelPull(model: string): Promise<void>
  configs(body: { [key: string]: any }): Promise<void>
}

type ModelList = {
  data: any[]
}

export class CortexAPI implements ICortexAPI {
  queue = new PQueue({ concurrency: 1 })

  constructor() {
    this.queue.add(() => this.healthz())
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
      .add(() => ky.get(`${API_URL}/v1/models?limit=-1`).json<ModelList>())
      .then((e) =>
        typeof e === 'object' ? e.data.map((e) => this.transformModel(e)) : []
      )
  }

  /**
   * Pulls a model from HuggingFace via cortex.cpp
   * @param model
   * @returns
   */
  pullModel(model: string, id?: string, name?: string): Promise<void> {
    return this.queue.add(() =>
      ky
        .post(`${API_URL}/v1/models/pull`, { json: { model, id, name } })
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
  importModel(
    model: string,
    modelPath: string,
    name?: string,
    option?: string
  ): Promise<void> {
    return this.queue.add(() =>
      ky
        .post(`${API_URL}/v1/models/import`, {
          json: { model, modelPath, name, option },
        })
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
      ky.delete(`${API_URL}/v1/models/${model}`).json().then()
    )
  }

  /**
   * Update a model in cortex.cpp
   * @param model
   * @returns
   */
  updateModel(model: Partial<Model>): Promise<void> {
    return this.queue.add(() =>
      ky
        .patch(`${API_URL}/v1/models/${model.id}`, { json: { ...model } })
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
        .delete(`${API_URL}/v1/models/pull`, { json: { taskId: model } })
        .json()
        .then()
    )
  }

  /**
   * Check model status
   * @param model
   */
  async getModelStatus(model: string): Promise<boolean> {
    return this.queue
      .add(() => ky.get(`${API_URL}/v1/models/status/${model}`))
      .then((e) => true)
      .catch(() => false)
  }

  /**
   * Do health check on cortex.cpp
   * @returns
   */
  healthz(): Promise<void> {
    return ky
      .get(`${API_URL}/healthz`, {
        retry: {
          limit: 20,
          delay: () => 500,
          methods: ['get'],
        },
      })
      .then(() => {})
  }

  /**
   * Configure model pull options
   * @param body
   */
  configs(body: { [key: string]: any }): Promise<void> {
    return this.queue.add(() =>
      ky.patch(`${API_URL}/v1/configs`, { json: body }).then(() => {})
    )
  }

  /**
   * TRansform model to the expected format (e.g. parameters, settings, metadata)
   * @param model
   * @returns
   */
  private transformModel(model: any) {
    model.parameters = {
      ...extractInferenceParams(model),
      ...model.parameters,
    }
    model.settings = {
      ...extractModelLoadParams(model),
      ...model.settings,
    }
    model.metadata = model.metadata ?? {
      tags: [],
      size: model.size ?? model.metadata?.size ?? 0,
    }
    return model as Model
  }
}
