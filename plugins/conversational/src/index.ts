import { PluginType, fs } from "@janhq/core";
import { ConversationalPlugin } from "@janhq/core/lib/plugins";
import { Message, Conversation } from "@janhq/core/lib/types";

/**
 * JanConversationalPlugin is a ConversationalPlugin implementation that provides
 * functionality for managing conversations in a Jan bot.
 */
export default class JanConversationalPlugin implements ConversationalPlugin {
  /**
   * Returns the type of the plugin.
   */
  type(): PluginType {
    return PluginType.Conversational;
  }

  /**
   * Called when the plugin is loaded.
   */
  onLoad() {
    console.debug("JanConversationalPlugin loaded");
  }

  /**
   * Called when the plugin is unloaded.
   */
  onUnload() {
    console.debug("JanConversationalPlugin unloaded");
  }

  /**
   * Returns a Promise that resolves to an array of Conversation objects.
   */
  getConversations(): Promise<Conversation[]> {
    return this.getConversationDocs().then((conversationIds) =>
      Promise.all(
        conversationIds.map((conversationId) =>
          this.loadConversationFromMarkdownFile(
            `conversations/${conversationId}`
          )
        )
      )
    );
  }

  /**
   * Saves a Conversation object to a Markdown file.
   * @param conversation The Conversation object to save.
   */
  saveConversation(conversation: Conversation): Promise<void> {
    return this.writeMarkdownToFile(conversation);
  }

  /**
   * Deletes a conversation with the specified ID.
   * @param conversationId The ID of the conversation to delete.
   */
  deleteConversation(conversationId: string): Promise<void> {
    return fs.deleteFile(`conversations/${conversationId}.md`);
  }

  /**
   * Returns a Promise that resolves to an array of conversation IDs.
   * The conversation IDs are the names of the Markdown files in the "conversations" directory.
   * @private
   */
  private async getConversationDocs(): Promise<string[]> {
    return fs.listFiles("conversations").then((files: string[]) => {
      return Promise.all(
        files.filter((file) => file.startsWith("conversation-"))
      );
    });
  }

  /**
   * Parses a Markdown string and returns a Conversation object.
   * @param markdown The Markdown string to parse.
   * @private
   */
  private parseConversationMarkdown(markdown: string): Conversation {
    const conversation: Conversation = {
      _id: "",
      name: "",
      messages: [],
    };
    var currentMessage: Message | undefined = undefined;
    for (const line of markdown.split("\n")) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith("- _id:")) {
        conversation._id = trimmedLine.replace("- _id:", "").trim();
      } else if (trimmedLine.startsWith("- modelId:")) {
        conversation.modelId = trimmedLine.replace("- modelId:", "").trim();
      } else if (trimmedLine.startsWith("- name:")) {
        conversation.name = trimmedLine.replace("- name:", "").trim();
      } else if (trimmedLine.startsWith("- lastMessage:")) {
        conversation.message = trimmedLine.replace("- lastMessage:", "").trim();
      } else if (trimmedLine.startsWith("- summary:")) {
        conversation.summary = trimmedLine.replace("- summary:", "").trim();
      } else if (
        trimmedLine.startsWith("- createdAt:") &&
        currentMessage === undefined
      ) {
        conversation.createdAt = trimmedLine.replace("- createdAt:", "").trim();
      } else if (trimmedLine.startsWith("- updatedAt:")) {
        conversation.updatedAt = trimmedLine.replace("- updatedAt:", "").trim();
      } else if (trimmedLine.startsWith("- botId:")) {
        conversation.botId = trimmedLine.replace("- botId:", "").trim();
      } else if (trimmedLine.startsWith("- user:")) {
        if (currentMessage)
          currentMessage.user = trimmedLine.replace("- user:", "").trim();
      } else if (trimmedLine.startsWith("- createdAt:")) {
        if (currentMessage)
          currentMessage.createdAt = trimmedLine
            .replace("- createdAt:", "")
            .trim();

        currentMessage.updatedAt = currentMessage.createdAt;
      } else if (trimmedLine.startsWith("- message:")) {
        if (currentMessage)
          currentMessage.message = trimmedLine.replace("- message:", "").trim();
      } else if (trimmedLine.startsWith("- Message ")) {
        const messageMatch = trimmedLine.match(/- Message (message-\d+):/);
        if (messageMatch) {
          if (currentMessage) {
            conversation.messages.push(currentMessage);
          }
          currentMessage = { _id: messageMatch[1] };
        }
      } else if (
        currentMessage?.message &&
        !trimmedLine.startsWith("## Messages")
      ) {
        currentMessage.message = currentMessage.message + "\n" + line.trim();
      } else if (trimmedLine.startsWith("## Messages")) {
        currentMessage = undefined;
      } else {
        console.log("missing field processing: ", trimmedLine);
      }
    }

    return conversation;
  }

  /**
   * Loads a Conversation object from a Markdown file.
   * @param filePath The path to the Markdown file.
   * @private
   */
  private async loadConversationFromMarkdownFile(
    filePath: string
  ): Promise<Conversation | undefined> {
    try {
      const markdown: string = await fs.readFile(filePath);
      return this.parseConversationMarkdown(markdown);
    } catch (err) {
      return undefined;
    }
  }

  /**
   * Generates a Markdown string from a Conversation object.
   * @param conversation The Conversation object to generate Markdown from.
   * @private
   */
  private generateMarkdown(conversation: Conversation): string {
    // Generate the Markdown content based on the Conversation object
    const conversationMetadata = `
  - _id: ${conversation._id}
  - modelId: ${conversation.modelId}
  - name: ${conversation.name}
  - lastMessage: ${conversation.message}
  - summary: ${conversation.summary}
  - createdAt: ${conversation.createdAt}
  - updatedAt: ${conversation.updatedAt}
  - botId: ${conversation.botId}
  `;

    const messages = conversation.messages.map(
      (message) => `
  - Message ${message._id}:
    - createdAt: ${message.createdAt}
    - user: ${message.user}
    - message: ${message.message?.trim()}
  `
    );

    return `## Conversation Metadata
  ${conversationMetadata}
## Messages
  ${messages.map((msg) => msg.trim()).join("\n")}
  `;
  }

  /**
   * Writes a Conversation object to a Markdown file.
   * @param conversation The Conversation object to write to a Markdown file.
   * @private
   */
  private async writeMarkdownToFile(conversation: Conversation) {
    await fs.mkdir("conversations");
    // Generate the Markdown content
    const markdownContent = this.generateMarkdown(conversation);
    // Write the content to a Markdown file
    await fs.writeFile(`conversations/${conversation._id}.md`, markdownContent);
  }
}
