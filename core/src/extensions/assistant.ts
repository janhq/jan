import { Assistant, AssistantInterface } from '../index'
import { BaseExtension } from '../extension'

/**
 * Assistant extension for managing assistants.
 * @extends BaseExtension
 */
export abstract class AssistantExtension extends BaseExtension implements AssistantInterface {
  abstract createAssistant(assistant: Assistant): Promise<void>
  abstract deleteAssistant(assistant: Assistant): Promise<void>
  abstract getAssistants(): Promise<Assistant[]>
}
