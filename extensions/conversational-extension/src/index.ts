import {
  ConversationalExtension,
  Thread,
  ThreadAssistantInfo,
  ThreadMessage,
} from '@janhq/core'
<<<<<<< HEAD
=======
import ky, { KyInstance } from 'ky'
import PQueue from 'p-queue'

type ThreadList = {
  data: Thread[]
}

type MessageList = {
  data: ThreadMessage[]
}
>>>>>>> upstream/main

/**
 * JanConversationalExtension is a ConversationalExtension implementation that provides
 * functionality for managing threads.
 */
<<<<<<< HEAD
export default class JanConversationalExtension extends ConversationalExtension {
=======
export default class CortexConversationalExtension extends ConversationalExtension {
  queue = new PQueue({ concurrency: 1 })

  api?: KyInstance
  /**
   * Get the API instance
   * @returns
   */
  async apiInstance(): Promise<KyInstance> {
    if(this.api) return this.api
    const apiKey = (await window.core?.api.appToken()) ?? 'cortex.cpp'
    this.api = ky.extend({
      prefixUrl: API_URL,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })
    return this.api
  }
>>>>>>> upstream/main
  /**
   * Called when the extension is loaded.
   */
  async onLoad() {
    // this.queue.add(() => this.healthz())
  }

  /**
   * Called when the extension is unloaded.
   */
  onUnload() {}

  /**
   * Returns a Promise that resolves to an array of Conversation objects.
   */
  async listThreads(): Promise<Thread[]> {
<<<<<<< HEAD
    return window.core.api.listThreads()
=======
    return this.queue.add(() =>
      this.apiInstance().then((api) =>
        api
          .get('v1/threads?limit=-1')
          .json<ThreadList>()
          .then((e) => e.data)
      )
    ) as Promise<Thread[]>
>>>>>>> upstream/main
  }

  /**
   * Saves a Thread object to a json file.
   * @param thread The Thread object to save.
   */
  async createThread(thread: Thread): Promise<Thread> {
<<<<<<< HEAD
    return window.core.api.createThread({ thread })
=======
    return this.queue.add(() =>
      this.apiInstance().then((api) =>
        api.post('v1/threads', { json: thread }).json<Thread>()
      )
    ) as Promise<Thread>
>>>>>>> upstream/main
  }

  /**
   * Saves a Thread object to a json file.
   * @param thread The Thread object to save.
   */
  async modifyThread(thread: Thread): Promise<void> {
<<<<<<< HEAD
    return window.core.api.modifyThread({ thread })
=======
    return this.queue
      .add(() =>
        this.apiInstance().then((api) =>
          api.patch(`v1/threads/${thread.id}`, { json: thread })
        )
      )
      .then()
>>>>>>> upstream/main
  }

  /**
   * Delete a thread with the specified ID.
   * @param threadId The ID of the thread to delete.
   */
  async deleteThread(threadId: string): Promise<void> {
<<<<<<< HEAD
    return window.core.api.deleteThread({ threadId })
=======
    return this.queue
      .add(() =>
        this.apiInstance().then((api) => api.delete(`v1/threads/${threadId}`))
      )
      .then()
>>>>>>> upstream/main
  }

  /**
   * Adds a new message to a specified thread.
   * @param message The ThreadMessage object to be added.
   * @returns A Promise that resolves when the message has been added.
   */
  async createMessage(message: ThreadMessage): Promise<ThreadMessage> {
<<<<<<< HEAD
    return window.core.api.createMessage({ message })
=======
    return this.queue.add(() =>
      this.apiInstance().then((api) =>
        api
          .post(`v1/threads/${message.thread_id}/messages`, {
            json: message,
          })
          .json<ThreadMessage>()
      )
    ) as Promise<ThreadMessage>
>>>>>>> upstream/main
  }

  /**
   * Modifies a message in a thread.
   * @param message
   * @returns
   */
  async modifyMessage(message: ThreadMessage): Promise<ThreadMessage> {
<<<<<<< HEAD
    return window.core.api.modifyMessage({ message })
=======
    return this.queue.add(() =>
      this.apiInstance().then((api) =>
        api
          .patch(`v1/threads/${message.thread_id}/messages/${message.id}`, {
            json: message,
          })
          .json<ThreadMessage>()
      )
    ) as Promise<ThreadMessage>
>>>>>>> upstream/main
  }

  /**
   * Deletes a specific message from a thread.
   * @param threadId The ID of the thread containing the message.
   * @param messageId The ID of the message to be deleted.
   * @returns A Promise that resolves when the message has been successfully deleted.
   */
  async deleteMessage(threadId: string, messageId: string): Promise<void> {
<<<<<<< HEAD
    return window.core.api.deleteMessage({ threadId, messageId })
=======
    return this.queue
      .add(() =>
        this.apiInstance().then((api) =>
          api.delete(`v1/threads/${threadId}/messages/${messageId}`)
        )
      )
      .then()
>>>>>>> upstream/main
  }

  /**
   * Retrieves all messages for a specified thread.
   * @param threadId The ID of the thread to get messages from.
   * @returns A Promise that resolves to an array of ThreadMessage objects.
   */
  async listMessages(threadId: string): Promise<ThreadMessage[]> {
<<<<<<< HEAD
    return window.core.api.listMessages({ threadId })
=======
    return this.queue.add(() =>
      this.apiInstance().then((api) =>
        api
          .get(`v1/threads/${threadId}/messages?order=asc&limit=-1`)
          .json<MessageList>()
          .then((e) => e.data)
      )
    ) as Promise<ThreadMessage[]>
>>>>>>> upstream/main
  }

  /**
   * Retrieves the assistant information for a specified thread.
   * @param threadId The ID of the thread for which to retrieve assistant information.
   * @returns A Promise that resolves to a ThreadAssistantInfo object containing
   * the details of the assistant associated with the specified thread.
   */
  async getThreadAssistant(threadId: string): Promise<ThreadAssistantInfo> {
<<<<<<< HEAD
    return window.core.api.getThreadAssistant({ threadId })
=======
    return this.queue.add(() =>
      this.apiInstance().then((api) =>
        api
          .get(`v1/assistants/${threadId}?limit=-1`)
          .json<ThreadAssistantInfo>()
      )
    ) as Promise<ThreadAssistantInfo>
>>>>>>> upstream/main
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
<<<<<<< HEAD
    return window.core.api.createThreadAssistant(threadId, assistant)
=======
    return this.queue.add(() =>
      this.apiInstance().then((api) =>
        api
          .post(`v1/assistants/${threadId}`, { json: assistant })
          .json<ThreadAssistantInfo>()
      )
    ) as Promise<ThreadAssistantInfo>
>>>>>>> upstream/main
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
<<<<<<< HEAD
    return window.core.api.modifyThreadAssistant({ threadId, assistant })
=======
    return this.queue.add(() =>
      this.apiInstance().then((api) =>
        api
          .patch(`v1/assistants/${threadId}`, { json: assistant })
          .json<ThreadAssistantInfo>()
      )
    ) as Promise<ThreadAssistantInfo>
  }

  /**
   * Do health check on cortex.cpp
   * @returns
   */
  async healthz(): Promise<void> {
    return this.apiInstance()
      .then((api) =>
        api.get('healthz', {
          retry: { limit: 20, delay: () => 500, methods: ['get'] },
        })
      )
      .then(() => {})
>>>>>>> upstream/main
  }
}
