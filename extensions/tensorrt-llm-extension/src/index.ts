/**
 * @module tensorrt-llm-extension/src/index
 */

import {
  Compatibility,
  DownloadEvent,
  DownloadRequest,
  DownloadState,
  InstallationState,
  baseName,
  downloadFile,
  events,
  executeOnMain,
  joinPath,
  showToast,
  systemInformation,
  LocalOAIEngine,
  fs,
  MessageRequest,
  ModelEvent,
  getJanDataFolderPath,
  SystemInformation,
  Model,
} from '@janhq/core'

/**
 * TensorRTLLMExtension - Implementation of LocalOAIEngine
 * @extends BaseOAILocalInferenceProvider
 * Provide pre-populated models for TensorRTLLM
 */
export default class TensorRTLLMExtension extends LocalOAIEngine {
  /**
   * Override custom function name for loading and unloading model
   * Which are implemented from node module
   */
  override provider = PROVIDER
  override inferenceUrl = INFERENCE_URL
  override nodeModule = NODE

  private supportedGpuArch = ['ampere', 'ada']

  override compatibility() {
    return COMPATIBILITY as unknown as Compatibility
  }

  override async onLoad(): Promise<void> {
    super.onLoad()

    if ((await this.installationState()) === 'Installed') {
      const models = MODELS as unknown as Model[]
      this.registerModels(models)
    }
  }

  override async install(): Promise<void> {
    await this.removePopulatedModels()

    const info = await systemInformation()

    if (!this.isCompatible(info)) return

    const janDataFolderPath = await getJanDataFolderPath()
    const engineVersion = TENSORRT_VERSION

    const executableFolderPath = await joinPath([
      janDataFolderPath,
      'engines',
      this.provider,
      engineVersion,
      info.gpuSetting?.gpus[0].arch,
    ])

    if (!(await fs.existsSync(executableFolderPath))) {
      await fs.mkdir(executableFolderPath)
    }

    const placeholderUrl = DOWNLOAD_RUNNER_URL
    const tensorrtVersion = TENSORRT_VERSION

    const url = placeholderUrl
      .replace(/<version>/g, tensorrtVersion)
      .replace(/<gpuarch>/g, info.gpuSetting!.gpus[0]!.arch!)

    const tarball = await baseName(url)

    const tarballFullPath = await joinPath([executableFolderPath, tarball])
    const downloadRequest: DownloadRequest = {
      url,
      localPath: tarballFullPath,
      extensionId: this.name,
      downloadType: 'extension',
    }
    downloadFile(downloadRequest)

    const onFileDownloadSuccess = async (state: DownloadState) => {
      // if other download, ignore
      if (state.fileName !== tarball) return
      events.off(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
      await executeOnMain(
        this.nodeModule,
        'decompressRunner',
        tarballFullPath,
        executableFolderPath
      )
      events.emit(DownloadEvent.onFileUnzipSuccess, state)

      // Prepopulate models as soon as it's ready
      const models = MODELS as unknown as Model[]
      this.registerModels(models).then(() => {
        showToast(
          'Extension installed successfully.',
          'New models are added to Model Hub.'
        )
      })
    }
    events.on(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
  }

  private async removePopulatedModels(): Promise<void> {
    const models = MODELS as unknown as Model[]
    console.debug(`removePopulatedModels`, JSON.stringify(models))
    const janDataFolderPath = await getJanDataFolderPath()
    const modelFolderPath = await joinPath([janDataFolderPath, 'models'])

    for (const model of models) {
      const modelPath = await joinPath([modelFolderPath, model.id])

      try {
        await fs.rm(modelPath)
      } catch (err) {
        console.error(`Error removing model ${modelPath}`, err)
      }
    }
    events.emit(ModelEvent.OnModelsUpdate, {})
  }

  override async loadModel(model: Model): Promise<void> {
    if ((await this.installationState()) === 'Installed')
      return super.loadModel(model)

    throw new Error('EXTENSION_IS_NOT_INSTALLED::TensorRT-LLM extension')
  }

  override async installationState(): Promise<InstallationState> {
    const info = await systemInformation()

    if (!this.isCompatible(info)) return 'NotCompatible'
    const firstGpu = info.gpuSetting?.gpus[0]
    const janDataFolderPath = await getJanDataFolderPath()
    const engineVersion = TENSORRT_VERSION

    const enginePath = await joinPath([
      janDataFolderPath,
      'engines',
      this.provider,
      engineVersion,
      firstGpu.arch,
      info.osInfo.platform === 'win32' ? 'nitro.exe' : 'nitro',
    ])

    // For now, we just check the executable of nitro x tensor rt
    return (await fs.existsSync(enginePath)) ? 'Installed' : 'NotInstalled'
  }

  override stopInference() {
    if (!this.loadedModel) return
    showToast(
      'Unable to Stop Inference',
      'The model does not support stopping inference.'
    )
    return Promise.resolve()
  }

  override async inference(data: MessageRequest) {
    if (!this.loadedModel) return
    // TensorRT LLM Extension supports streaming only
    if (data.model && data.model.parameters) data.model.parameters.stream = true
    super.inference(data)
  }

  isCompatible(info: SystemInformation): info is Required<SystemInformation> & {
    gpuSetting: { gpus: { arch: string }[] }
  } {
    const firstGpu = info.gpuSetting?.gpus[0]
    return (
      !!info.osInfo &&
      !!info.gpuSetting &&
      !!firstGpu &&
      info.gpuSetting.gpus.length > 0 &&
      this.compatibility().platform.includes(info.osInfo.platform) &&
      !!firstGpu.arch &&
      firstGpu.name.toLowerCase().includes('nvidia') &&
      this.supportedGpuArch.includes(firstGpu.arch)
    )
  }
}
