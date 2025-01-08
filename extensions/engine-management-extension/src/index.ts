import {
  EngineManagementExtension,
  InferenceEngine,
  DefaultEngineVariant,
  Engines,
  EngineConfig,
  EngineVariant,
  EngineReleased,
  executeOnMain,
  systemInformation,
  Model,
  fs,
  joinPath,
  events,
  ModelEvent,
} from '@janhq/core'
import ky, { HTTPError } from 'ky'
import PQueue from 'p-queue'
import { EngineError } from './error'
import { getJanDataFolderPath } from '@janhq/core'

/**
 * JSONEngineManagementExtension is a EngineManagementExtension implementation that provides
 * functionality for managing engines.
 */
export default class JSONEngineManagementExtension extends EngineManagementExtension {
  queue = new PQueue({ concurrency: 1 })

  /**
   * Called when the extension is loaded.
   */
  async onLoad() {
    // Symlink Engines Directory
    await executeOnMain(NODE, 'symlinkEngines')
    // Run Healthcheck
    this.queue.add(() => this.healthz())
    // Update default local engine
    this.updateDefaultEngine()

    // Populate default remote engines
    this.populateDefaultRemoteEngines()
  }

  /**
   * Called when the extension is unloaded.
   */
  onUnload() {}

  /**
   * @returns A Promise that resolves to an object of list engines.
   */
  async getEngines(): Promise<Engines> {
    return this.queue.add(() =>
      ky
        .get(`${API_URL}/v1/engines`)
        .json<Engines>()
        .then((e) => e)
    ) as Promise<Engines>
  }

  /**
   * @returns A Promise that resolves to an object of list engines.
   */
  async getRemoteModels(name: string): Promise<any> {
    return this.queue.add(() =>
      ky
        .get(`${API_URL}/v1/models/remote/${name}`)
        .json<Model[]>()
        .then((e) => e)
        .catch(() => [])
    ) as Promise<Model[]>
  }

  /**
   * @param name - Inference engine name.
   * @returns A Promise that resolves to an array of installed engine.
   */
  async getInstalledEngines(name: InferenceEngine): Promise<EngineVariant[]> {
    return this.queue.add(() =>
      ky
        .get(`${API_URL}/v1/engines/${name}`)
        .json<EngineVariant[]>()
        .then((e) => e)
    ) as Promise<EngineVariant[]>
  }

  /**
   * @param name - Inference engine name.
   * @param version - Version of the engine.
   * @param platform - Optional to sort by operating system. macOS, linux, windows.
   * @returns A Promise that resolves to an array of latest released engine by version.
   */
  async getReleasedEnginesByVersion(
    name: InferenceEngine,
    version: string,
    platform?: string
  ) {
    return this.queue.add(() =>
      ky
        .get(`${API_URL}/v1/engines/${name}/releases/${version}`)
        .json<EngineReleased[]>()
        .then((e) =>
          platform ? e.filter((r) => r.name.includes(platform)) : e
        )
    ) as Promise<EngineReleased[]>
  }

  /**
   * @param name - Inference engine name.
   * @param platform - Optional to sort by operating system. macOS, linux, windows.
   * @returns A Promise that resolves to an array of latest released engine by version.
   */
  async getLatestReleasedEngine(name: InferenceEngine, platform?: string) {
    return this.queue.add(() =>
      ky
        .get(`${API_URL}/v1/engines/${name}/releases/latest`)
        .json<EngineReleased[]>()
        .then((e) =>
          platform ? e.filter((r) => r.name.includes(platform)) : e
        )
    ) as Promise<EngineReleased[]>
  }

  /**
   * @param name - Inference engine name.
   * @returns A Promise that resolves to intall of engine.
   */
  async installEngine(name: string, engineConfig: EngineConfig) {
    return this.queue.add(() =>
      ky
        .post(`${API_URL}/v1/engines/${name}/install`, { json: engineConfig })
        .then((e) => e)
    ) as Promise<{ messages: string }>
  }

  /**
   * Add a new remote engine
   * @returns A Promise that resolves to intall of engine.
   */
  async addRemoteEngine(engineConfig: EngineConfig) {
    return this.queue.add(() =>
      ky.post(`${API_URL}/v1/engines`, { json: engineConfig }).then((e) => e)
    ) as Promise<{ messages: string }>
  }

  /**
   * @param name - Inference engine name.
   * @returns A Promise that resolves to unintall of engine.
   */
  async uninstallEngine(name: InferenceEngine, engineConfig: EngineConfig) {
    return this.queue.add(() =>
      ky
        .delete(`${API_URL}/v1/engines/${name}/install`, { json: engineConfig })
        .then((e) => e)
    ) as Promise<{ messages: string }>
  }

  /**
   * Add a new remote model
   * @param model - Remote model object.
   */
  async addRemoteModel(model: Model) {
    return this.queue.add(() =>
      ky.post(`${API_URL}/v1/models/add`, { json: model }).then((e) => e)
    )
  }

  /**
   * @param name - Inference engine name.
   * @returns A Promise that resolves to an object of default engine.
   */
  async getDefaultEngineVariant(name: InferenceEngine) {
    return this.queue.add(() =>
      ky
        .get(`${API_URL}/v1/engines/${name}/default`)
        .json<{ messages: string }>()
        .then((e) => e)
    ) as Promise<DefaultEngineVariant>
  }

  /**
   * @body variant - string
   * @body version - string
   * @returns A Promise that resolves to set default engine.
   */
  async setDefaultEngineVariant(
    name: InferenceEngine,
    engineConfig: EngineConfig
  ) {
    return this.queue.add(() =>
      ky
        .post(`${API_URL}/v1/engines/${name}/default`, { json: engineConfig })
        .then((e) => e)
    ) as Promise<{ messages: string }>
  }

  /**
   * @returns A Promise that resolves to update engine.
   */
  async updateEngine(name: InferenceEngine, engineConfig?: EngineConfig) {
    return this.queue.add(() =>
      ky
        .post(`${API_URL}/v1/engines/${name}/update`, { json: engineConfig })
        .then((e) => e)
    ) as Promise<{ messages: string }>
  }

  /**
   * Do health check on cortex.cpp
   * @returns
   */
  async healthz(): Promise<void> {
    return ky
      .get(`${API_URL}/healthz`, {
        retry: { limit: 20, delay: () => 500, methods: ['get'] },
      })
      .then(() => {})
  }

  /**
   * Update default local engine
   * This is to use built-in engine variant in case there is no default engine set
   */
  async updateDefaultEngine() {
    try {
      const variant = await this.getDefaultEngineVariant(
        InferenceEngine.cortex_llamacpp
      )
      const installedEngines = await this.getInstalledEngines(
        InferenceEngine.cortex_llamacpp
      )
      if (
        !installedEngines.some(
          (e) => e.name === variant.variant && e.version === variant.version
        )
      ) {
        throw new EngineError(
          'Default engine is not available, use bundled version.'
        )
      }
    } catch (error) {
      if (
        (error instanceof HTTPError && error.response.status === 400) ||
        error instanceof EngineError
      ) {
        const systemInfo = await systemInformation()
        const variant = await executeOnMain(
          NODE,
          'engineVariant',
          systemInfo.gpuSetting
        )
        await this.setDefaultEngineVariant(InferenceEngine.cortex_llamacpp, {
          variant: variant,
          version: `${CORTEX_ENGINE_VERSION}`,
        })
      } else {
        console.error('An unexpected error occurred:', error)
      }
    }
  }

  /**
   * This is to populate default remote engines in case there is no customized remote engine setting
   */
  async populateDefaultRemoteEngines() {
    const engines = await this.getEngines()
    if (
      !Object.values(engines)
        .flat()
        .some((e) => e.type === 'remote')
    ) {
      await Promise.all(
        DEFAULT_REMOTE_ENGINES.map(async (engine) => {
          const { id, ...data } = engine

          /// BEGIN - Migrate legacy api key settings
          let api_key = undefined
          if (id) {
            const apiKeyPath = await joinPath([
              await getJanDataFolderPath(),
              'settings',
              id,
              'settings.json',
            ])
            if (await fs.existsSync(apiKeyPath)) {
              const settings = await fs.readFileSync(apiKeyPath, 'utf-8')
              api_key = JSON.parse(settings).find(
                (e) => e.key === `${data.engine}-api-key`
              )?.controllerProps?.value
            }
          }
          data.api_key = api_key
          /// END - Migrate legacy api key settings

          await this.addRemoteEngine(data).catch(console.error)
        })
      )
      DEFAULT_REMOTE_MODELS.forEach(async (data: Model) => {
        await this.addRemoteModel(data).catch(() => {})
      })
      events.emit(ModelEvent.OnModelsUpdate, { fetch: true })
    }
  }
}
