import { InferenceInterface, MessageRequest, ThreadMessage } from '../index'
import { BaseExtension } from '../extension'

/**
 * Inference extension. Start, stop and inference models.
 */
export abstract class InferenceExtension extends BaseExtension implements InferenceInterface {
  abstract inference(data: MessageRequest): Promise<ThreadMessage>
}
