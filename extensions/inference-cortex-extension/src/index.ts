/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-extension/src/index
 */

import { Model, LocalOAIEngine, executeOnMain, systemInformation, showToast, InstallationPackage, InstallationState, DownloadState, events, DownloadEvent, InferenceEngine, SettingComponentProps } from '@janhq/core'


const waitInMs = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const extensionName = '@janhq/inference-cortex-extension'
type DownloadItem = {
  id: string;
  time: {
    elapsed: number;
    remaining: number;
  };
  size: {
    total: number;
    transferred: number;
  };
  progress: number;
  checksum?: string;
  status: DownloadStatus;
  error?: string;
  metadata?: Record<string, unknown>;
}

enum DownloadStatus {
  Pending = 'pending',
  Downloading = 'downloading',
  Error = 'error',
  Downloaded = 'downloaded',
}


const downloadStateMap : Record<DownloadStatus, DownloadState["downloadState"]> = {
  [DownloadStatus.Pending]: 'downloading',
  [DownloadStatus.Downloading]: 'downloading',
  [DownloadStatus.Error]: 'error',
  [DownloadStatus.Downloaded]: 'end'
}

declare const DEFAULT_SETTINGS: Array<any>

enum Settings {
  cortexProcessConfig = 'cortex-process-config',
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
  private abortControllers: Record<string, string[]> = {};
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
      await this.installPackage(InferenceEngine.cortex_llamacpp);
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
      executeOnMain(NODE, 'getEngineInformation', InferenceEngine.cortex_onnx),
      executeOnMain(NODE, 'getEngineInformation', InferenceEngine.cortex_tensorrtllm),
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

  private async getEngineDownloadProgress(packageName: string): Promise<void> {
    const eventSourceUrl = await executeOnMain(NODE, 'getEngineDownloadProgressUrl') as string
    const eventSource = new EventSource(eventSourceUrl)
    return new Promise((resolve, reject) => {
    eventSource.onerror = (error: any) => {
      console.error('Failed to get download progress', error)
      showToast('Failed to get download progress', error.message || 'Exception occurred')
      reject(error)
    }
    eventSource.onmessage = (eventSourceEvent) => {
      if(!this.abortControllers[packageName]){
        eventSource.close()
        events.emit(DownloadEvent.onFileDownloadError, {
          extensionId: extensionName,
          modelId: packageName,
          downloadState: 'error',
          error: 'aborted'
        })
        return resolve()
      }
      if (!eventSourceEvent?.data){
        eventSource.close()
        showToast('Failed to get download progress', 'No data received')
        return reject('No data received')
      }
      
      const downloadItems = JSON.parse(eventSourceEvent.data);
      if (!downloadItems.length) {
        eventSource.close();
        return resolve()
      }
      const filerDownloadItems = downloadItems.filter((data: any) => {
        if(data.title.includes(packageName)){
          return true
        }
        if(packageName === InferenceEngine.cortex_tensorrtllm && data.title.includes('Cuda Toolkit')){
          return true
        }
        return false
      })
      if(!filerDownloadItems.length){
        eventSource.close();
        return resolve()
      }

      if(!this.abortControllers[packageName]?.length){
        this.abortControllers[packageName].push(...filerDownloadItems.map(({ id }: {id: string}) => id))
      }

      const cortexDownloadItem = filerDownloadItems[0].children[0] as DownloadItem;
      const totalSize = filerDownloadItems.map(({children} : {children: DownloadItem[]}) => children[0].size.total).reduce((acc: number, size: number) => acc + size, 0);
      const transferredSize = filerDownloadItems.map(({children} : {children: DownloadItem[]}) => children[0].size.transferred).reduce((acc: number, size: number) => acc + size, 0);

      const downloadState: DownloadState = {
        modelId: packageName,
        fileName: cortexDownloadItem.id,
        time: cortexDownloadItem.time,
        speed: 0,
        percent: Number(((transferredSize / Math.max(totalSize, 1))).toFixed(2)),
        size: cortexDownloadItem.size,
        downloadState: downloadStateMap[cortexDownloadItem.status],
        downloadType: 'engine',
        error: cortexDownloadItem.error,
        extensionId: extensionName,
      };

      if(filerDownloadItems.some(({children} : {children: DownloadItem[]}) => children[0].status === DownloadStatus.Error)){
        eventSource.close();
        showToast('Failed to download package', cortexDownloadItem.error || 'Exception occurred')
        events.emit(DownloadEvent.onFileDownloadError, downloadState)
        return resolve()
      }
      if(filerDownloadItems.every(({children} : {children: DownloadItem[]}) => children[0].status === DownloadStatus.Downloaded)){
        eventSource.close();
        events.emit(DownloadEvent.onFileDownloadSuccess, downloadState)
        return resolve()
      }
      events.emit(DownloadEvent.onFileDownloadUpdate, downloadState)
    }
    })
  }


  async installPackage(packageName: string): Promise<void> {
    try{
      this.abortControllers[packageName] = []
      await executeOnMain(NODE, 'initCortexEngine', packageName)
      await waitInMs(2000)
      await this.getEngineDownloadProgress(packageName)
    } catch (error: any) {
      delete this.abortControllers[packageName]
      console.error('Failed to install package', error)
      showToast('Failed to install package', error.message || 'Exception occurred')
    }
  }

  async abortPackageInstallation(packageName: string): Promise<void> {
    try {
      await executeOnMain(NODE, 'abortCortexEngineDownload', this.abortControllers[packageName])
      delete this.abortControllers[packageName]
    } catch (error: any) {
      console.error('Failed to abort package installation', error)
      showToast('Failed to abort package installation', error.message || 'Exception occurred')
    }
  }



  async onSettingUpdate<T>(key: string, value: T): Promise<void> {
    if(key === Settings.cortexProcessConfig){
      await Promise.all((value as SettingComponentProps[]).map(async setting => {
        if(setting.key === Settings.cortexHost){
          this.cortexHost = setting.controllerProps.value as string
          await executeOnMain(NODE, 'setHost', this.cortexHost)
        }
        if(setting.key === Settings.cortexPort){
          this.cortexPort = setting.controllerProps.value as string
          await executeOnMain(NODE, 'setPort', this.cortexPort)
        }
        if(setting.key === Settings.cortexEnginePort){
          this.cortexEnginePort = setting.controllerProps.value as string
          await executeOnMain(NODE, 'setEnginePort', this.cortexEnginePort)
        }
      }))
      await executeOnMain(NODE, 'killSubprocess')
      const system = await systemInformation()
      await executeOnMain(NODE, 'spawnCortexProcess', system)
    }
  }
}
