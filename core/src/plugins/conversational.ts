import { JanPlugin } from "../plugin";
import { Conversation } from "../types/index";

export abstract class ConversationalPlugin extends JanPlugin {
  abstract getConversations(): Promise<any[]>;
  abstract saveConversation(conversation: Conversation): Promise<void>;
  abstract deleteConversation(conversationId: string): Promise<void>;
}
