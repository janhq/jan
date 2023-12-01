import { Assistant } from "../index";
import { JanPlugin } from "../plugin";

/**
 * Abstract class for assistant plugins.
 * @extends JanPlugin
 */
export abstract class AssistantPlugin extends JanPlugin {
  /**
   * Creates a new assistant.
   * @param {Assistant} assistant - The assistant object to be created.
   * @returns {Promise<void>} A promise that resolves when the assistant has been created.
   */
  abstract createAssistant(assistant: Assistant): Promise<void>;

  /**
   * Deletes an existing assistant.
   * @param {Assistant} assistant - The assistant object to be deleted.
   * @returns {Promise<void>} A promise that resolves when the assistant has been deleted.
   */
  abstract deleteAssistant(assistant: Assistant): Promise<void>;

  /**
   * Retrieves all existing assistants.
   * @returns {Promise<Assistant[]>} A promise that resolves to an array of all assistants.
   */
  abstract getAssistants(): Promise<Assistant[]>;
}
