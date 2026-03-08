import { InferenceInterface, MessageRequest, ThreadMessage } from '../../types'
import { BaseExtension, ExtensionTypeEnum } from '../extension'

/**
 * Inference extension. Start, stop and inference models.
 */
export abstract class InferenceExtension extends BaseExtension implements InferenceInterface {
  /**
   * Inference extension type.
   */
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.Inference
  }

  abstract inference(data: MessageRequest): Promise<ThreadMessage>
}
