/**
 * @module tensorrt-llm-extension/src/index
 */

import {
  DownloadEvent,
  DownloadState,
  Model,
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

  /**
   * models implemented by the extension
   * define pre-populated models
   */
  models(): Model[] {
    return models as unknown as Model[]
  }

  // TODO: find a better name for this function
  // TODO: passing system info to the function
  // TODO: passing network to here as well
  async downloadRunner() {
    const binaryFolderPath = await executeOnMain(
      this.nodeModule,
      'binaryFolder'
    )
    if (!(await fs.existsSync(binaryFolderPath))) {
      await fs.mkdirSync(binaryFolderPath)
    }

    const placeholderUrl = DOWNLOAD_RUNNER_URL
    console.log(`NamH typeof ${typeof placeholderUrl} ${placeholderUrl}`)
    const version = '0.1.0'
    const gpuarch = 'ada'

    const url = placeholderUrl
      .replace(/<version>/g, version)
      .replace(/<gpuarch>/g, gpuarch)

    const tarball = await baseName(url)

    const tarballFullPath = await joinPath([binaryFolderPath, tarball])
    downloadFile(url, tarballFullPath)

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
