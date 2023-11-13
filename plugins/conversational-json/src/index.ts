import { PluginType, fs } from '@janhq/core'
import { ConversationalPlugin } from '@janhq/core/lib/plugins'
import { Conversation } from '@janhq/core/lib/types'

/**
 * JSONConversationalPlugin is a ConversationalPlugin implementation that provides
 * functionality for managing conversations.
 *
 * TODO: expose join here
 */
export default class JSONConversationalPlugin implements ConversationalPlugin {
  private static readonly _homeDir = 'threads'

  /**
   * Returns the type of the plugin.
   */
  type(): PluginType {
    return PluginType.Conversational
  }

  /**
   * Called when the plugin is loaded.
   */
  onLoad() {
    fs.mkdir(JSONConversationalPlugin._homeDir)
    console.debug('JSONConversationalPlugin loaded')
  }

  /**
   * Called when the plugin is unloaded.
   */
  onUnload() {
    console.debug('JSONConversationalPlugin unloaded')
  }

  /**
   * Returns a Promise that resolves to an array of Conversation objects.
   */
  async getConversations(): Promise<Conversation[]> {
    try {
      const convoIds = await this.getConversationDocs()

      const promises = convoIds.map((conversationId) => {
        return this.readConvo(conversationId)
      })
      const promiseResults = await Promise.allSettled(promises)
      const convos = promiseResults
        .map((result) => {
          if (result.status === 'fulfilled') {
            return JSON.parse(result.value) as Conversation
          }
        })
        .filter((convo) => convo != null)
      convos.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      console.debug('getConversations: ', JSON.stringify(convos, null, 2))
      return convos
    } catch (error) {
      console.error(error)
      return []
    }
  }

  /**
   * Saves a Conversation object to a Markdown file.
   * @param conversation The Conversation object to save.
   */
  saveConversation(conversation: Conversation): Promise<void> {
    return fs
      .mkdir(`${JSONConversationalPlugin._homeDir}/${conversation._id}`)
      .then(() =>
        fs.writeFile(
          `${JSONConversationalPlugin._homeDir}/${conversation._id}/${conversation._id}.json`,
          JSON.stringify(conversation)
        )
      )
  }

  /**
   * Deletes a conversation with the specified ID.
   * @param conversationId The ID of the conversation to delete.
   */
  deleteConversation(conversationId: string): Promise<void> {
    return fs.rmdir(`${JSONConversationalPlugin._homeDir}/${conversationId}`)
  }

  /**
   * A promise builder for reading a conversation from a file.
   * @param convoId the conversation id we are reading from.
   * @returns data of the conversation
   */
  private async readConvo(convoId: string): Promise<any> {
    return fs.readFile(
      `${JSONConversationalPlugin._homeDir}/${convoId}/${convoId}.json`
    )
  }

  /**
   * Returns a Promise that resolves to an array of conversation IDs.
   * The conversation IDs are the names of the Markdown files in the "conversations" directory.
   * @private
   */
  private async getConversationDocs(): Promise<string[]> {
    return fs
      .listFiles(JSONConversationalPlugin._homeDir)
      .then((files: string[]) => {
        return Promise.all(files.filter((file) => file.startsWith('jan-')))
      })
  }
}
