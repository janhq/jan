import { JanPlugin } from "../plugin";
import { Conversation } from "../types/index";

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
   * @param {Conversation} conversation - The conversation to save.
   * @returns {Promise<void>} A promise that resolves when the conversation is saved.
   */
  abstract saveConversation(conversation: Conversation): Promise<void>;

  /**
   * Deletes a conversation.
   * @abstract
   * @param {string} conversationId - The ID of the conversation to delete.
   * @returns {Promise<void>} A promise that resolves when the conversation is deleted.
   */
  abstract deleteConversation(conversationId: string): Promise<void>;
}
