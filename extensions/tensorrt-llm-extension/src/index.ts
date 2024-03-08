/**
 * @module tensorrt-llm-extension/src/index
 */

import { Model } from '@janhq/core'
import { OAILocalInferenceProvider } from './base/OAILocalInferenceProvider'
import models from '../models.json'

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

  /*
   * Inference method
   * @param data - The message request
   */
  // inference(data: MessageRequest) {
  //   // Your customized inference logic here
  // }
}
