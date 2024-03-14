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
  systemInformations,
  LocalOAIEngine,
  fs,
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
    const info = await systemInformations()
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

    const binaryFolderPath = await executeOnMain(
      this.nodeModule,
      'binaryFolder'
    )
    if (!(await fs.existsSync(binaryFolderPath))) {
      await fs.mkdirSync(binaryFolderPath)
    }

    const placeholderUrl = DOWNLOAD_RUNNER_URL
    const tensorrtVersion = TENSORRT_VERSION

    const url = placeholderUrl
      .replace(/<version>/g, tensorrtVersion)
      .replace(/<gpuarch>/g, firstGpu.arch)

    const tarball = await baseName(url)

    const tarballFullPath = await joinPath([binaryFolderPath, tarball])
    const downloadRequest: DownloadRequest = {
      url,
      localPath: tarballFullPath,
      extensionId: EXTENSION_NAME,
      downloadType: 'extension',
    }
    downloadFile(downloadRequest)

    // TODO: wrap this into a Promise
    const onFileDownloadSuccess = async (state: DownloadState) => {
      // if other download, ignore
      if (state.fileName !== tarball) return
      events.off(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
      await executeOnMain(this.nodeModule, 'decompressRunner', tarballFullPath)
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

  override async installationState(): Promise<InstallationState> {
    // For now, we just check the executable of nitro x tensor rt
    const isNitroExecutableAvailable = await executeOnMain(
      this.nodeModule,
      'isNitroExecutableAvailable'
    )

    return isNitroExecutableAvailable ? 'Installed' : 'NotInstalled'
  }

  override onInferenceStopped() {
    if (!this.isRunning) return
    showToast(
      'Unable to Stop Inference',
      'The model does not support stopping inference.'
    )
    return Promise.resolve()
  }
}
