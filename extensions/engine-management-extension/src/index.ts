import {
  EngineManagementExtension,
  InferenceEngine,
  DefaultEngineVariant,
  Engines,
  EngineVariant,
  EngineReleased,
  executeOnMain,
  systemInformation,
} from '@janhq/core'
import ky, { HTTPError } from 'ky'
import PQueue from 'p-queue'
import { EngineError } from './error'

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
    try {
      const variant = await this.getDefaultEngineVariant(
        InferenceEngine.cortex_llamacpp
      )
      // Check whether should use bundled version or installed version
      // Only use larger version
      if (this.compareVersions(CORTEX_ENGINE_VERSION, variant.version) > 0) {
        throw new EngineError(
          'Default engine version is smaller than bundled version'
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
  async installEngine(
    name: InferenceEngine,
    engineConfig: { variant: string; version?: string }
  ) {
    return this.queue.add(() =>
      ky
        .post(`${API_URL}/v1/engines/${name}/install`, { json: engineConfig })
        .then((e) => e)
    ) as Promise<{ messages: string }>
  }

  /**
   * @param name - Inference engine name.
   * @returns A Promise that resolves to unintall of engine.
   */
  async uninstallEngine(
    name: InferenceEngine,
    engineConfig: { variant: string; version: string }
  ) {
    return this.queue.add(() =>
      ky
        .delete(`${API_URL}/v1/engines/${name}/install`, { json: engineConfig })
        .then((e) => e)
    ) as Promise<{ messages: string }>
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
    engineConfig: { variant: string; version: string }
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
  async updateEngine(name: InferenceEngine) {
    return this.queue.add(() =>
      ky.post(`${API_URL}/v1/engines/${name}/update`).then((e) => e)
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

  private compareVersions(version1: string, version2: string): number {
    const parseVersion = (version: string) => version.split('.').map(Number)

    const [major1, minor1, patch1] = parseVersion(version1.replace(/^v/, ''))
    const [major2, minor2, patch2] = parseVersion(version2.replace(/^v/, ''))

    if (major1 !== major2) return major1 - major2
    if (minor1 !== minor2) return minor1 - minor2
    return patch1 - patch2
  }
}
