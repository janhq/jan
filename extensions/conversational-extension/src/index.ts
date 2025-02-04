import {
  ConversationalExtension,
  Thread,
  ThreadAssistantInfo,
  ThreadMessage,
} from '@janhq/core'
import ky from 'ky'
import PQueue from 'p-queue'

type ThreadList = {
  data: Thread[]
}

type MessageList = {
  data: ThreadMessage[]
}

/**
 * JSONConversationalExtension is a ConversationalExtension implementation that provides
 * functionality for managing threads.
 */
export default class CortexConversationalExtension extends ConversationalExtension {
  queue = new PQueue({ concurrency: 1 })

  /**
   * Called when the extension is loaded.
   */
  async onLoad() {
    this.queue.add(() => this.healthz())
  }

  /**
   * Called when the extension is unloaded.
   */
  onUnload() {}

  /**
   * Returns a Promise that resolves to an array of Conversation objects.
   */
  async listThreads(): Promise<Thread[]> {
    return this.queue.add(() =>
      ky
        .get(`${API_URL}/v1/threads?limit=-1`)
        .json<ThreadList>()
        .then((e) => e.data)
    ) as Promise<Thread[]>
  }

  /**
   * Saves a Thread object to a json file.
   * @param thread The Thread object to save.
   */
  async createThread(thread: Thread): Promise<Thread> {
    return this.queue.add(() =>
      ky.post(`${API_URL}/v1/threads`, { json: thread }).json<Thread>()
    ) as Promise<Thread>
  }

  /**
   * Saves a Thread object to a json file.
   * @param thread The Thread object to save.
   */
  async modifyThread(thread: Thread): Promise<void> {
    return this.queue
      .add(() =>
        ky.patch(`${API_URL}/v1/threads/${thread.id}`, { json: thread })
      )
      .then()
  }

  /**
   * Delete a thread with the specified ID.
   * @param threadId The ID of the thread to delete.
   */
  async deleteThread(threadId: string): Promise<void> {
    return this.queue
      .add(() => ky.delete(`${API_URL}/v1/threads/${threadId}`))
      .then()
  }

  /**
   * Adds a new message to a specified thread.
   * @param message The ThreadMessage object to be added.
   * @returns A Promise that resolves when the message has been added.
   */
  async createMessage(message: ThreadMessage): Promise<ThreadMessage> {
    return this.queue.add(() =>
      ky
        .post(`${API_URL}/v1/threads/${message.thread_id}/messages`, {
          json: message,
        })
        .json<ThreadMessage>()
    ) as Promise<ThreadMessage>
  }

  /**
   * Modifies a message in a thread.
   * @param message
   * @returns
   */
  async modifyMessage(message: ThreadMessage): Promise<ThreadMessage> {
    return this.queue.add(() =>
      ky
        .patch(
          `${API_URL}/v1/threads/${message.thread_id}/messages/${message.id}`,
          {
            json: message,
          }
        )
        .json<ThreadMessage>()
    ) as Promise<ThreadMessage>
  }

  /**
   * Deletes a specific message from a thread.
   * @param threadId The ID of the thread containing the message.
   * @param messageId The ID of the message to be deleted.
   * @returns A Promise that resolves when the message has been successfully deleted.
   */
  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    return this.queue
      .add(() =>
        ky.delete(`${API_URL}/v1/threads/${threadId}/messages/${messageId}`)
      )
      .then()
  }

  /**
   * Retrieves all messages for a specified thread.
   * @param threadId The ID of the thread to get messages from.
   * @returns A Promise that resolves to an array of ThreadMessage objects.
   */
  async listMessages(threadId: string): Promise<ThreadMessage[]> {
    return this.queue.add(() =>
      ky
        .get(`${API_URL}/v1/threads/${threadId}/messages?order=asc&limit=-1`)
        .json<MessageList>()
        .then((e) => e.data)
    ) as Promise<ThreadMessage[]>
  }

  /**
   * Retrieves the assistant information for a specified thread.
   * @param threadId The ID of the thread for which to retrieve assistant information.
   * @returns A Promise that resolves to a ThreadAssistantInfo object containing
   * the details of the assistant associated with the specified thread.
   */
  async getThreadAssistant(threadId: string): Promise<ThreadAssistantInfo> {
    return this.queue.add(() =>
      ky
        .get(`${API_URL}/v1/assistants/${threadId}?limit=-1`)
        .json<ThreadAssistantInfo>()
    ) as Promise<ThreadAssistantInfo>
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
    return this.queue.add(() =>
      ky
        .post(`${API_URL}/v1/assistants/${threadId}`, { json: assistant })
        .json<ThreadAssistantInfo>()
    ) as Promise<ThreadAssistantInfo>
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
    return this.queue.add(() =>
      ky
        .patch(`${API_URL}/v1/assistants/${threadId}`, { json: assistant })
        .json<ThreadAssistantInfo>()
    ) as Promise<ThreadAssistantInfo>
  }

  /**
   * Do health check on cortex.cpp
   * @returns
   */
  async healthz(): Promise<void> {
    return ky
      .get(`${API_URL}/healthz`, {
        retry: { limit: 20, delay: () => 500, methods: ['get'] },
      })
      .then(() => {})
  }
}
