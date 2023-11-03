import { JanPlugin, PluginType } from "../plugin";

export interface Conversation {
  _id: string;
  modelId?: string;
  botId?: string;
  name: string;
  message?: string;
  summary?: string;
  createdAt?: string;
  updatedAt?: string;
  messages: Message[];
}
export interface Message {
  message?: string;
  user?: string;
  _id: string;
  createdAt?: string;
  updatedAt?: string;
}

export abstract class ConversationalPlugin extends JanPlugin {
  abstract getConversations(): Promise<any[]>;
  abstract saveConversation(conversation: Conversation): Promise<void>;
  abstract deleteConversation(conversationId: string): Promise<void>;
}
