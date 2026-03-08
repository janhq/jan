import { Assistant, AssistantInterface } from '../../types'
import { BaseExtension, ExtensionTypeEnum } from '../extension'

/**
 * Assistant extension for managing assistants.
 * @extends BaseExtension
 */
export abstract class AssistantExtension extends BaseExtension implements AssistantInterface {
  /**
   * Assistant extension type.
   */
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.Assistant
  }

  abstract createAssistant(assistant: Assistant): Promise<void>
  abstract deleteAssistant(assistant: Assistant): Promise<void>
  abstract getAssistants(): Promise<Assistant[]>
}
