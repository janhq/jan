import { PluginType, fs } from "@janhq/core";
import { ConversationalPlugin } from "@janhq/core/lib/plugins";
import { Conversation } from "@janhq/core/lib/types";

/**
 * JSONConversationalPlugin is a ConversationalPlugin implementation that provides
 * functionality for managing conversations.
 */
export default class JSONConversationalPlugin implements ConversationalPlugin {
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
    fs.mkdir("conversations")
    console.debug("JSONConversationalPlugin loaded")
  }

  /**
   * Called when the plugin is unloaded.
   */
  onUnload() {
    console.debug("JSONConversationalPlugin unloaded")
  }

  /**
   * Returns a Promise that resolves to an array of Conversation objects.
   */
  getConversations(): Promise<Conversation[]> {
    return this.getConversationDocs().then((conversationIds) =>
      Promise.all(
        conversationIds.map((conversationId) =>
          fs
            .readFile(`conversations/${conversationId}/${conversationId}.json`)
            .then((data) => {
              return JSON.parse(data) as Conversation;
            })
        )
      ).then((conversations) =>
        conversations.sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
      )
    );
  }

  /**
   * Saves a Conversation object to a Markdown file.
   * @param conversation The Conversation object to save.
   */
  saveConversation(conversation: Conversation): Promise<void> {
    return fs
      .mkdir(`conversations/${conversation._id}`)
      .then(() =>
        fs.writeFile(
          `conversations/${conversation._id}/${conversation._id}.json`,
          JSON.stringify(conversation)
        )
      );
  }

  /**
   * Deletes a conversation with the specified ID.
   * @param conversationId The ID of the conversation to delete.
   */
  deleteConversation(conversationId: string): Promise<void> {
    return fs.rmdir(`conversations/${conversationId}`);
  }

  /**
   * Returns a Promise that resolves to an array of conversation IDs.
   * The conversation IDs are the names of the Markdown files in the "conversations" directory.
   * @private
   */
  private async getConversationDocs(): Promise<string[]> {
    return fs.listFiles(`conversations`).then((files: string[]) => {
      return Promise.all(files.filter((file) => file.startsWith("jan-")));
    });
  }
}
