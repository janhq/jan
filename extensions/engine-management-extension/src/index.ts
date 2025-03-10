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
  EngineEvent,
} from '@janhq/core'
import ky, { HTTPError } from 'ky'
import PQueue from 'p-queue'
import { EngineError } from './error'
import { getJanDataFolderPath } from '@janhq/core'
import { engineVariant } from './utils'

interface ModelList {
  data: Model[]
}
/**
 * JanEngineManagementExtension is a EngineManagementExtension implementation that provides
 * functionality for managing engines.
 */
export default class JanEngineManagementExtension extends EngineManagementExtension {
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

    // Migrate
    this.migrate()
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
    return ky
      .get(`${API_URL}/v1/models/remote/${name}`)
      .json<ModelList>()
      .catch(() => ({
        data: [],
      })) as Promise<ModelList>
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
  async addRemoteEngine(
    engineConfig: EngineConfig,
    persistModels: boolean = true
  ) {
    // Populate default settings
    if (
      engineConfig.metadata?.transform_req?.chat_completions &&
      !engineConfig.metadata.transform_req.chat_completions.template
    )
      engineConfig.metadata.transform_req.chat_completions.template =
        DEFAULT_REQUEST_PAYLOAD_TRANSFORM

    if (
      engineConfig.metadata?.transform_resp?.chat_completions &&
      !engineConfig.metadata.transform_resp.chat_completions?.template
    )
      engineConfig.metadata.transform_resp.chat_completions.template =
        DEFAULT_RESPONSE_BODY_TRANSFORM

    if (engineConfig.metadata && !engineConfig.metadata?.header_template)
      engineConfig.metadata.header_template = DEFAULT_REQUEST_HEADERS_TRANSFORM

    return this.queue.add(() =>
      ky.post(`${API_URL}/v1/engines`, { json: engineConfig }).then((e) => {
        if (persistModels && engineConfig.metadata?.get_models_url) {
          // Pull /models from remote models endpoint
          return this.populateRemoteModels(engineConfig)
            .then(() => e)
            .catch(() => e)
        }
        return e
      })
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
    return this.queue
      .add(() =>
        ky
          .post(`${API_URL}/v1/models/add`, {
            json: {
              inference_params: {
                max_tokens: 4096,
                temperature: 0.7,
                top_p: 0.95,
                stream: true,
                frequency_penalty: 0,
                presence_penalty: 0,
              },
              ...model,
            },
          })
          .then((e) => e)
      )
      .then(() => {})
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
      .then(() => {
        this.queue.concurrency = Infinity
      })
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
        ) ||
        variant.version < CORTEX_ENGINE_VERSION
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
        const variant = await engineVariant(systemInfo.gpuSetting)
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

          await this.addRemoteEngine(data, false).catch(console.error)
        })
      )
      events.emit(EngineEvent.OnEngineUpdate, {})
      await Promise.all(
        DEFAULT_REMOTE_MODELS.map((data: Model) =>
          this.addRemoteModel(data).catch(() => {})
        )
      )
      events.emit(ModelEvent.OnModelsUpdate, { fetch: true })
    }
  }

  /**
   * Pulls models list from the remote provider and persist
   * @param engineConfig
   * @returns
   */
  private populateRemoteModels = async (engineConfig: EngineConfig) => {
    return this.getRemoteModels(engineConfig.engine)
      .then((models: ModelList) => {
        if (models?.data)
          Promise.all(
            models.data.map((model) =>
              this.addRemoteModel({
                ...model,
                engine: engineConfig.engine as InferenceEngine,
                model: model.model ?? model.id,
              }).catch(console.info)
            )
          ).then(() => {
            events.emit(ModelEvent.OnModelsUpdate, { fetch: true })
          })
      })
      .catch(console.info)
  }

  /**
   * Update engine settings to the latest version
   */
  migrate = async () => {
    // Ensure health check is done
    await this.queue.onEmpty()

    const version = await this.getSetting<string>('version', '0.0.0')
    const engines = await this.getEngines()
    if (version < VERSION) {

      console.log('Migrating engine settings...')
      // Migrate engine settings
      await Promise.all(
        DEFAULT_REMOTE_ENGINES.map((engine) => {
          const { id, ...data } = engine

          data.api_key = engines[id]?.api_key
          return this.updateEngine(id,{
            ...data,
          }).catch(console.error)
        })
      )
      await this.updateSettings([
        {
          key: 'version',
          controllerProps: {
            value: VERSION,
          },
        },
      ])
    }
  }
}
