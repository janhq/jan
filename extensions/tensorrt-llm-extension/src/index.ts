/**
 * @module tensorrt-llm-extension/src/index
 */

import {
  Compatibility,
  DownloadEvent,
  DownloadRequest,
  DownloadState,
  GpuSetting,
  InstallationState,
  Model,
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
  private supportedPlatform = ['win32', 'linux']
  private isUpdateAvailable = false

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
    console.debug(
      `TensorRTLLMExtension installing pre-requisites... ${JSON.stringify(info)}`
    )
    const gpuSetting: GpuSetting | undefined = info.gpuSetting
    if (gpuSetting === undefined || gpuSetting.gpus.length === 0) {
      console.error('No GPU setting found. Please check your GPU setting.')
      return
    }

    // TODO: we only check for the first graphics card. Need to refactor this later.
    const firstGpu = gpuSetting.gpus[0]
    if (!firstGpu.name.toLowerCase().includes('nvidia')) {
      console.error('No Nvidia GPU found. Please check your GPU setting.')
      return
    }

    if (firstGpu.arch === undefined) {
      console.error('No GPU architecture found. Please check your GPU setting.')
      return
    }

    if (!this.supportedGpuArch.includes(firstGpu.arch)) {
      console.error(
        `Your GPU: ${firstGpu} is not supported. Only 20xx, 30xx, 40xx series are supported.`
      )
      return
    }

    const janDataFolderPath = await getJanDataFolderPath()
    const engineVersion = TENSORRT_VERSION

    const executableFolderPath = await joinPath([
      janDataFolderPath,
      'engines',
      this.provider,
      engineVersion,
      firstGpu.arch,
    ])

    if (!(await fs.existsSync(executableFolderPath))) {
      await fs.mkdir(executableFolderPath)
    }

    const placeholderUrl = DOWNLOAD_RUNNER_URL
    const tensorrtVersion = TENSORRT_VERSION

    const url = placeholderUrl
      .replace(/<version>/g, tensorrtVersion)
      .replace(/<gpuarch>/g, firstGpu.arch)

    const tarball = await baseName(url)

    const tarballFullPath = await joinPath([executableFolderPath, tarball])
    const downloadRequest: DownloadRequest = {
      url,
      localPath: tarballFullPath,
      extensionId: EXTENSION_NAME,
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
    if (model.engine !== this.provider) return

    if ((await this.installationState()) === 'Installed')
      return super.loadModel(model)
    else {
      events.emit(ModelEvent.OnModelFail, {
        ...model,
        error: {
          message: 'EXTENSION_IS_NOT_INSTALLED::TensorRT-LLM extension',
        },
      })
    }
  }

  override updatable() {
    return this.isUpdateAvailable
  }

  override async installationState(): Promise<InstallationState> {
    const info = await systemInformation()

    const gpuSetting: GpuSetting | undefined = info.gpuSetting
    if (gpuSetting === undefined) {
      console.warn(
        'No GPU setting found. TensorRT-LLM extension is not installed'
      )
      return 'NotInstalled' // TODO: maybe disabled / incompatible is more appropriate
    }

    if (gpuSetting.gpus.length === 0) {
      console.warn('No GPU found. TensorRT-LLM extension is not installed')
      return 'NotInstalled'
    }

    const firstGpu = gpuSetting.gpus[0]
    if (!firstGpu.name.toLowerCase().includes('nvidia')) {
      console.error('No Nvidia GPU found. Please check your GPU setting.')
      return 'NotInstalled'
    }

    if (firstGpu.arch === undefined) {
      console.error('No GPU architecture found. Please check your GPU setting.')
      return 'NotInstalled'
    }

    if (!this.supportedGpuArch.includes(firstGpu.arch)) {
      console.error(
        `Your GPU: ${firstGpu} is not supported. Only 20xx, 30xx, 40xx series are supported.`
      )
      return 'NotInstalled'
    }

    const osInfo = info.osInfo
    if (!osInfo) {
      console.error('No OS information found. Please check your OS setting.')
      return 'NotInstalled'
    }

    if (!this.supportedPlatform.includes(osInfo.platform)) {
      console.error(
        `Your OS: ${osInfo.platform} is not supported. Only Windows and Linux are supported.`
      )
      return 'NotInstalled'
    }
    const janDataFolderPath = await getJanDataFolderPath()
    const engineVersion = TENSORRT_VERSION

    const enginePath = await joinPath([
      janDataFolderPath,
      'engines',
      this.provider,
      engineVersion,
      firstGpu.arch,
      osInfo.platform === 'win32' ? 'nitro.exe' : 'nitro',
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
    if (data.model) data.model.parameters.stream = true
    super.inference(data)
  }
}
