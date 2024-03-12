/**
 * @module tensorrt-llm-extension/src/index
 */

import {
  Compatibility,
  DownloadEvent,
  DownloadState,
  GpuSetting,
  Model,
  NetworkConfig,
  baseName,
  downloadFile,
  events,
  executeOnMain,
  joinPath,
} from '@janhq/core'
import { OAILocalInferenceProvider } from './base/OAILocalInferenceProvider'
import models from '../models.json'
import { fs } from '@janhq/core'

/**
 * TensorRTLLMExtension - Implementation of BaseOAILocalInferenceProvider
 * @extends BaseOAILocalInferenceProvider
 * Provide pre-populated models for TensorRTLLM
 */
export default class TensorRTLLMExtension extends OAILocalInferenceProvider {
  /**
   * Override custom function name for loading and unloading model
   * Which are implemented from node module
   */
  // override loadModelFunctionName: string = 'loadModel'
  // override unloadModelFunctionName: string = 'unloadModel'

  override provider = 'nitro-tensorrt-llm'
  override inference_url = INFERENCE_URL
  override nodeModule = NODE

  compatibility() {
    return COMPATIBILITY as unknown as Compatibility
  }
  /**
   * models implemented by the extension
   * define pre-populated models
   */
  models(): Model[] {
    return models as unknown as Model[]
  }

  // TODO: find a better name for this function
  async downloadRunner(gpuSetting: GpuSetting, network?: NetworkConfig) {
    if (gpuSetting.gpus.length === 0) {
      console.error('No GPU found. Please check your GPU setting.')
      return
    }

    // TODO: we only check for the first graphics card. Need to refactor this later.
    const firstGpu = gpuSetting.gpus[0]
    if (!firstGpu.name.toLowerCase().includes('nvidia')) {
      console.error('No Nvidia GPU found. Please check your GPU setting.')
      return
    }

    let gpuArch: string | undefined = undefined

    if (firstGpu.name.includes('20')) gpuArch = 'turing'
    else if (firstGpu.name.includes('30')) gpuArch = 'ampere'
    else if (firstGpu.name.includes('40')) gpuArch = 'ada'
    else {
      console.log(
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
      .replace(/<gpuarch>/g, gpuArch)

    const tarball = await baseName(url)

    const tarballFullPath = await joinPath([binaryFolderPath, tarball])
    downloadFile(url, tarballFullPath, network)

    const onFileDownloadSuccess = async (state: DownloadState) => {
      // if other download, ignore
      if (state.fileName !== tarball) return

      events.off(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)

      // unzip
      await executeOnMain(
        this.nodeModule,
        'decompressRunner',
        tarballFullPath,
        binaryFolderPath
      )
    }
    events.on(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
  }

  /*
   * Inference method
   * @param data - The message request
   */
  // inference(data: MessageRequest) {
  //   // Your customized inference logic here
  // }
}
