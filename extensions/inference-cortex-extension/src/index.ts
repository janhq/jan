/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-extension/src/index
 */

import { Model, LocalOAIEngine, executeOnMain, systemInformation, showToast, InstallationPackage } from '@janhq/core'

declare const DEFAULT_SETTINGS: Array<any>

enum Settings {
  cortexHost = 'cortex-host',
  cortexPort = 'cortex-port',
  cortexEnginePort = 'cortex-engine-port',
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

  installationPackages(): Promise<InstallationPackage[]> {
    return Promise.resolve([{
      name: "cortex.onnx",
    description: "This engine enables chat completion API calls using the Onnx engine",
    version: "0.0.1",
    installationState: "NotRequired"
    }, {
      name: "cortex.tensorrt-llm",
      description: "This engine enables chat completion API calls using the TensorrtLLM engine",
      version: "0.0.1",
      installationState: "NotRequired"
    }])
  }

  async installPackage(packageName: string): Promise<void> {
    try{
    await executeOnMain(NODE, 'initCortexEngine', packageName)
    } catch (error: any) {
      console.error('Failed to install package', error)
      showToast('Failed to install package', error.message || 'Exception occurred')
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
