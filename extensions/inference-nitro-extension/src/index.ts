/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-extension/src/index
 */

import {
  events,
  executeOnMain,
  Model,
  ModelEvent,
  LocalOAIEngine,
  InstallationState,
  systemInformation,
  fs,
  getJanDataFolderPath,
  joinPath,
  DownloadRequest,
  baseName,
  downloadFile,
  DownloadState,
  DownloadEvent,
} from '@janhq/core'

declare const CUDA_DOWNLOAD_URL: string
/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceNitroExtension extends LocalOAIEngine {
  nodeModule: string = NODE
  provider: string = 'nitro'

  /**
   * Checking the health for Nitro's process each 5 secs.
   */
  private static readonly _intervalHealthCheck = 5 * 1000

  /**
   * The interval id for the health check. Used to stop the health check.
   */
  private getNitroProcessHealthIntervalId: NodeJS.Timeout | undefined = undefined

  /**
   * Tracking the current state of nitro process.
   */
  private nitroProcessInfo: any = undefined

  /**
   * The URL for making inference requests.
   */
  inferenceUrl = ''

  /**
   * Subscribes to events emitted by the @janhq/core package.
   */
  async onLoad() {
    this.inferenceUrl = INFERENCE_URL

    // If the extension is running in the browser, use the base API URL from the core package.
    if (!('electronAPI' in window)) {
      this.inferenceUrl = `${window.core?.api?.baseApiUrl}/v1/chat/completions`
    }

    this.getNitroProcessHealthIntervalId = setInterval(
      () => this.periodicallyGetNitroHealth(),
      JanInferenceNitroExtension._intervalHealthCheck
    )
    const models = MODELS as unknown as Model[]
    this.registerModels(models)
    super.onLoad()

    executeOnMain(NODE, 'addAdditionalDependencies', {
      name: this.name,
      version: this.version,
    })
  }

  /**
   * Periodically check for nitro process's health.
   */
  private async periodicallyGetNitroHealth(): Promise<void> {
    const health = await executeOnMain(NODE, 'getCurrentNitroProcessInfo')

    const isRunning = this.nitroProcessInfo?.isRunning ?? false
    if (isRunning && health.isRunning === false) {
      console.debug('Nitro process is stopped')
      events.emit(ModelEvent.OnModelStopped, {})
    }
    this.nitroProcessInfo = health
  }

  override loadModel(model: Model): Promise<void> {
    if (model.engine !== this.provider) return Promise.resolve()
    this.getNitroProcessHealthIntervalId = setInterval(
      () => this.periodicallyGetNitroHealth(),
      JanInferenceNitroExtension._intervalHealthCheck
    )
    return super.loadModel(model)
  }

  override async unloadModel(model?: Model): Promise<void> {
    if (model?.engine && model.engine !== this.provider) return

    // stop the periocally health check
    if (this.getNitroProcessHealthIntervalId) {
      clearInterval(this.getNitroProcessHealthIntervalId)
      this.getNitroProcessHealthIntervalId = undefined
    }
    return super.unloadModel(model)
  }

  override async install(): Promise<void> {
    const info = await systemInformation()

    const platform = info.osInfo?.platform === 'win32' ? 'windows' : 'linux'
    const downloadUrl = CUDA_DOWNLOAD_URL

    const url = downloadUrl
      .replace('<version>', info.gpuSetting?.cuda?.version ?? '12.4')
      .replace('<platform>', platform)

    console.debug('Downloading Cuda Toolkit Dependency: ', url)

    const janDataFolderPath = await getJanDataFolderPath()

    const executableFolderPath = await joinPath([
      janDataFolderPath,
      'engines',
      this.name ?? 'nitro',
      this.version ?? '1.0.0',
    ])

    if (!(await fs.existsSync(executableFolderPath))) {
      await fs.mkdir(executableFolderPath)
    }

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
      console.log(state)
      // if other download, ignore
      if (state.fileName !== tarball) return
      events.off(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
      await executeOnMain(
        NODE,
        'decompressRunner',
        tarballFullPath,
        executableFolderPath
      )
      events.emit(DownloadEvent.onFileUnzipSuccess, state)
    }
    events.on(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
  }

  override async installationState(): Promise<InstallationState> {
    const info = await systemInformation()
    if (
      info.gpuSetting?.run_mode === 'gpu' &&
      !info.gpuSetting?.vulkan &&
      info.osInfo &&
      info.osInfo.platform !== 'darwin' &&
      !info.gpuSetting?.cuda?.exist
    ) {
      const janDataFolderPath = await getJanDataFolderPath()

      const executableFolderPath = await joinPath([
        janDataFolderPath,
        'engines',
        this.name ?? 'nitro',
        this.version ?? '1.0.0',
      ])

      if (!(await fs.existsSync(executableFolderPath))) return 'NotInstalled'
      return 'Installed'
    }
    return 'NotRequired'
  }
}
