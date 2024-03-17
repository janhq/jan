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
import models from '../models.json'

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
  override provider = 'nitro-tensorrt-llm'
  override inferenceUrl = INFERENCE_URL
  override nodeModule = NODE

  private supportedGpuArch = ['turing', 'ampere', 'ada']
  private supportedPlatform = ['win32', 'linux']

  compatibility() {
    return COMPATIBILITY as unknown as Compatibility
  }
  /**
   * models implemented by the extension
   * define pre-populated models
   */
  async models(): Promise<Model[]> {
    if ((await this.installationState()) === 'Installed')
      return models as unknown as Model[]
    return []
  }

  override async install(): Promise<void> {
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
    const extensionName = EXTENSION_NAME

    const executableFolderPath = await joinPath([
      janDataFolderPath,
      'engines',
      extensionName,
      firstGpu.arch,
    ])

    if (!(await fs.existsSync(executableFolderPath))) {
      await fs.mkdirSync(executableFolderPath)
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
      this.prePopulateModels().then(() => {
        showToast(
          'Extension installed successfully.',
          'New models are added to Model Hub.'
        )
      })
    }
    events.on(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
  }

  async onModelInit(model: Model): Promise<void> {
    if (model.engine !== this.provider) return

    if ((await this.installationState()) === 'Installed')
      return super.onModelInit(model)
    else {
      events.emit(ModelEvent.OnModelFail, {
        ...model,
        error: {
          message: 'EXTENSION_IS_NOT_INSTALLED::TensorRT-LLM extension',
        },
      })
    }
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
    const extensionName = EXTENSION_NAME
    const enginePath = await joinPath([
      await getJanDataFolderPath(),
      'engines',
      extensionName,
      firstGpu.arch,
      osInfo.platform === 'win32' ? 'nitro.exe' : 'nitro',
    ])

    // For now, we just check the executable of nitro x tensor rt
    return (await fs.existsSync(enginePath)) ? 'Installed' : 'NotInstalled'
  }

  override onInferenceStopped() {
    if (!this.isRunning) return
    showToast(
      'Unable to Stop Inference',
      'The model does not support stopping inference.'
    )
    return Promise.resolve()
  }

  inference(data: MessageRequest): void {
    if (!this.isRunning) return
    // TensorRT LLM Extension supports streaming only
    if (data.model) data.model.parameters.stream = true
    super.inference(data)
  }
}
