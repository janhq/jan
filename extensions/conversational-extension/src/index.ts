import {
  ConversationalExtension,
  Thread,
  ThreadAssistantInfo,
  ThreadMessage,
} from '@janhq/core'

/**
 * JanConversationalExtension is a ConversationalExtension implementation that provides
 * functionality for managing threads.
 */
export default class JanConversationalExtension extends ConversationalExtension {
  /**
   * Called when the extension is loaded.
   */
  async onLoad() {
    // no-opt
  }

  /**
   * Called when the extension is unloaded.
   */
  onUnload() {}

  /**
   * Returns a Promise that resolves to an array of Conversation objects.
   */
  async listThreads(): Promise<Thread[]> {
    return window.core.api.listThreads()
  }

  /**
   * Saves a Thread object to a json file.
   * @param thread The Thread object to save.
   */
  async createThread(thread: Thread): Promise<Thread> {
    return window.core.api.createThread({ thread })
  }

  /**
   * Saves a Thread object to a json file.
   * @param thread The Thread object to save.
   */
  async modifyThread(thread: Thread): Promise<void> {
    return window.core.api.modifyThread({ thread })
  }

  /**
   * Delete a thread with the specified ID.
   * @param threadId The ID of the thread to delete.
   */
  async deleteThread(threadId: string): Promise<void> {
    return window.core.api.deleteThread({ threadId })
  }

  /**
   * Adds a new message to a specified thread.
   * @param message The ThreadMessage object to be added.
   * @returns A Promise that resolves when the message has been added.
   */
  async createMessage(message: ThreadMessage): Promise<ThreadMessage> {
    return window.core.api.createMessage({ message })
  }

  /**
   * Modifies a message in a thread.
   * @param message
   * @returns
   */
  async modifyMessage(message: ThreadMessage): Promise<ThreadMessage> {
    return window.core.api.modifyMessage({ message })
  }

  /**
   * Deletes a specific message from a thread.
   * @param threadId The ID of the thread containing the message.
   * @param messageId The ID of the message to be deleted.
   * @returns A Promise that resolves when the message has been successfully deleted.
   */
  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    return window.core.api.deleteMessage({ threadId, messageId })
  }

  /**
   * Retrieves all messages for a specified thread.
   * @param threadId The ID of the thread to get messages from.
   * @returns A Promise that resolves to an array of ThreadMessage objects.
   */
  async listMessages(threadId: string): Promise<ThreadMessage[]> {
    return window.core.api.listMessages({ threadId })
  }

  /**
   * Retrieves the assistant information for a specified thread.
   * @param threadId The ID of the thread for which to retrieve assistant information.
   * @returns A Promise that resolves to a ThreadAssistantInfo object containing
   * the details of the assistant associated with the specified thread.
   */
  async getThreadAssistant(threadId: string): Promise<ThreadAssistantInfo> {
    return window.core.api.getThreadAssistant({ threadId })
  }
  /**
   * Creates a new assistant for the specified thread.
   * @param threadId The ID of the thread for which the assistant is being created.
   * @param assistant The information about the assistant to be created.
   * @returns A Promise that resolves to the newly created ThreadAssistantInfo object.
   */
  async createThreadAssistant(
    threadId: string,
    assistant: ThreadAssistantInfo
  ): Promise<ThreadAssistantInfo> {
    return window.core.api.createThreadAssistant(threadId, assistant)
  }

  /**
   * Modifies an existing assistant for the specified thread.
   * @param threadId The ID of the thread for which the assistant is being modified.
   * @param assistant The updated information for the assistant.
   * @returns A Promise that resolves to the updated ThreadAssistantInfo object.
   */
  async modifyThreadAssistant(
    threadId: string,
    assistant: ThreadAssistantInfo
  ): Promise<ThreadAssistantInfo> {
    return window.core.api.modifyThreadAssistant({ threadId, assistant })
  }
}
