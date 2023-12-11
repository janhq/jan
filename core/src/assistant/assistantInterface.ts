import { Assistant } from './assistantEntity'
/**
 * Assistant extension for managing assistants.
 * @extends BaseExtension
 */
export interface AssistantInterface {
  /**
   * Creates a new assistant.
   * @param {Assistant} assistant - The assistant object to be created.
   * @returns {Promise<void>} A promise that resolves when the assistant has been created.
   */
  createAssistant(assistant: Assistant): Promise<void>

  /**
   * Deletes an existing assistant.
   * @param {Assistant} assistant - The assistant object to be deleted.
   * @returns {Promise<void>} A promise that resolves when the assistant has been deleted.
   */
  deleteAssistant(assistant: Assistant): Promise<void>

  /**
   * Retrieves all existing assistants.
   * @returns {Promise<Assistant[]>} A promise that resolves to an array of all assistants.
   */
  getAssistants(): Promise<Assistant[]>
}
