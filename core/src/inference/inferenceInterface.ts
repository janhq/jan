import { MessageRequest, ThreadMessage } from '../message'
import { BaseExtension } from '../common'

/**
 * Inference extension. Start, stop and inference models.
 */
export interface InferenceExtension extends BaseExtension {
  /**
   * Processes an inference request.
   * @param data - The data for the inference request.
   * @returns The result of the inference request.
   */
  inference(data: MessageRequest): Promise<ThreadMessage>
}
