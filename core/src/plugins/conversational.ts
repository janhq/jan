import { Thread } from "../index";
import { JanPlugin } from "../plugin";

/**
 * Abstract class for conversational plugins.
 * @abstract
 * @extends JanPlugin
 */
export abstract class ConversationalPlugin extends JanPlugin {
  /**
   * Returns a list of conversations.
   * @abstract
   * @returns {Promise<any[]>} A promise that resolves to an array of conversations.
   */
  abstract getConversations(): Promise<any[]>;

  /**
   * Saves a conversation.
   * @abstract
   * @param {Thread} conversation - The conversation to save.
   * @returns {Promise<void>} A promise that resolves when the conversation is saved.
   */
  abstract saveConversation(conversation: Thread): Promise<void>;

  /**
   * Deletes a conversation.
   * @abstract
   * @param {string} conversationId - The ID of the conversation to delete.
   * @returns {Promise<void>} A promise that resolves when the conversation is deleted.
   */
  abstract deleteConversation(conversationId: string): Promise<void>;
}
