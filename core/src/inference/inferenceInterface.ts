import { MessageRequest, ThreadMessage } from '../message'

/**
 * Inference extension. Start, stop and inference models.
 */
export interface InferenceInterface {
  /**
   * Processes an inference request.
   * @param data - The data for the inference request.
   * @returns The result of the inference request.
   */
  inference(data: MessageRequest): Promise<ThreadMessage>
}
