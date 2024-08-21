/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-extension/src/index
 */

import { Model, LocalOAIEngine, executeOnMain, systemInformation, showToast, InstallationPackage, InstallationState, DownloadState, events, DownloadEvent } from '@janhq/core'

declare const DEFAULT_SETTINGS: Array<any>

enum Settings {
  cortexHost = 'cortex-host',
  cortexPort = 'cortex-port',
  cortexEnginePort = 'cortex-engine-port',
}

const installationStateMapByStatus: Record<string, InstallationState> = {
  ready : 'Installed',
  not_supported: 'NotCompatible',
  error: 'Corrupted',
  miss_configuration: 'Corrupted',
  not_initialized: 'NotInstalled',
}

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceCortexExtension extends LocalOAIEngine {
  nodeModule: string = NODE
  provider: string = 'cortex'
  cortexHost: string = ''
  cortexPort: string = ''
  cortexEnginePort: string = ''
  private abortControllers: Record<string, AbortController> = {};
  /**
   * The URL for making inference requests.
   */
  inferenceUrl = ''

  /**
   * Subscribes to events emitted by the @janhq/core package.
   */
  async onLoad() {
    this.inferenceUrl = INFERENCE_URL
    const system = await systemInformation()
    try {
      await executeOnMain(NODE, 'spawnCortexProcess', system)
    } catch (error: any) {
      console.error('Failed to spawn cortex process', error)
      showToast('Failed to spawn cortex process', error.message || 'Exception occurred')
    }
    const models = MODELS as unknown as Model[]
    super.onLoad()
    this.registerSettings(DEFAULT_SETTINGS)
    this.registerModels(models)
  }

  override async loadModel(model: Model): Promise<void> {
    if (model.engine !== this.provider) return Promise.resolve()
    return super.loadModel(model)
  }

  override async unloadModel(model?: Model): Promise<void> {
    if (model?.engine && model.engine !== this.provider) return

    return super.unloadModel(model)
  }

  async installationPackages(): Promise<InstallationPackage[]> {
    const [cortexOnnxInfo, cortexTensorrtLlmInfo] = await Promise.all([
      executeOnMain(NODE, 'getEngineInformation', 'cortex.onnx'),
      executeOnMain(NODE, 'getEngineInformation', 'cortex.tensorrt-llm'),
    ])
    return Promise.resolve([{
      name: "cortex.onnx",
    description: cortexOnnxInfo.description,
    version: cortexOnnxInfo.version,
    installationState: installationStateMapByStatus[cortexOnnxInfo.status]
    }, {
      name: "cortex.tensorrt-llm",
      description: cortexTensorrtLlmInfo.description,
      version: cortexTensorrtLlmInfo.version,
      installationState: installationStateMapByStatus[cortexTensorrtLlmInfo.status]
    }])
  }

  async installPackage(packageName: string): Promise<void> {
    try{
      this.abortControllers[packageName] = new AbortController()
      await executeOnMain(NODE, 'initCortexEngine', packageName) as AsyncIterable<DownloadState>
      const downloadState = await executeOnMain(NODE, 'getEngineDownloadProgress', packageName, this.abortControllers[packageName].signal)
    for await (const state of downloadState) {
      console.log('Download state:', state)
      events.emit(DownloadEvent.onFileDownloadUpdate, state)
    }
    } catch (error: any) {
      delete this.abortControllers[packageName]
      console.error('Failed to install package', error)
      showToast('Failed to install package', error.message || 'Exception occurred')
    }
  }

  async abortPackageInstallation(packageName: string): Promise<void> {
    try {
      await executeOnMain(NODE, 'abortCortexEngine', packageName)
      this.abortControllers[packageName].abort()
      delete this.abortControllers[packageName]
    } catch (error: any) {
      console.error('Failed to abort package installation', error)
      showToast('Failed to abort package installation', error.message || 'Exception occurred')
    }
  }



  onSettingUpdate<T>(key: string, value: T): void {
    if (key === Settings.cortexEnginePort) {
      this.cortexEnginePort = value as string
    } else if (key === Settings.cortexHost) {
      this.cortexHost = value as string
    } else {
      this.cortexPort = value as string
    }
    // TODO:  Add mechanism to update Cortex process
  }
}
