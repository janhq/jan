/**
 * Web Storage - localStorage-based implementation for threads and messages
 * Used when running in web mode (IS_WEB_APP=true)
 */

const THREADS_KEY = 'jan_web_threads'
const MESSAGES_PREFIX = 'jan_web_messages_'
const THREAD_ASSISTANT_PREFIX = 'jan_web_thread_assistant_'

function getThreads(): Thread[] {
  try {
    const data = localStorage.getItem(THREADS_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

function saveThreads(threads: Thread[]): void {
  localStorage.setItem(THREADS_KEY, JSON.stringify(threads))
}

function getMessages(threadId: string): unknown[] {
  try {
    const data = localStorage.getItem(MESSAGES_PREFIX + threadId)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

function saveMessages(threadId: string, messages: unknown[]): void {
  localStorage.setItem(MESSAGES_PREFIX + threadId, JSON.stringify(messages))
}

function getThreadAssistant(threadId: string): unknown | null {
  try {
    const data = localStorage.getItem(THREAD_ASSISTANT_PREFIX + threadId)
    return data ? JSON.parse(data) : null
  } catch {
    return null
  }
}

function saveThreadAssistant(threadId: string, assistant: unknown): void {
  localStorage.setItem(THREAD_ASSISTANT_PREFIX + threadId, JSON.stringify(assistant))
}

export const webStorage = {
  listThreads(): Thread[] {
    return getThreads()
  },

  createThread(thread: Thread): Thread {
    const threads = getThreads()
    threads.push(thread)
    saveThreads(threads)
    return thread
  },

  modifyThread(thread: Thread): void {
    const threads = getThreads()
    const idx = threads.findIndex((t) => t.id === thread.id)
    if (idx >= 0) {
      threads[idx] = thread
    } else {
      threads.push(thread)
    }
    saveThreads(threads)
  },

  deleteThread(threadId: string): void {
    const threads = getThreads().filter((t) => t.id !== threadId)
    saveThreads(threads)
    localStorage.removeItem(MESSAGES_PREFIX + threadId)
    localStorage.removeItem(THREAD_ASSISTANT_PREFIX + threadId)
  },

  listMessages(threadId: string): unknown[] {
    return getMessages(threadId)
  },

  createMessage(message: unknown & { thread_id?: string }): unknown {
    if (!message.thread_id) return message
    const messages = getMessages(message.thread_id)
    messages.push(message)
    saveMessages(message.thread_id, messages)
    return message
  },

  modifyMessage(message: unknown & { thread_id?: string; id?: string }): unknown {
    if (!message.thread_id) return message
    const messages = getMessages(message.thread_id)
    const idx = messages.findIndex((m) => (m as { id?: string }).id === message.id)
    if (idx >= 0) {
      messages[idx] = message
    } else {
      messages.push(message)
    }
    saveMessages(message.thread_id, messages)
    return message
  },

  deleteMessage(threadId: string, messageId: string): void {
    const messages = getMessages(threadId).filter(
      (m) => (m as { id?: string }).id !== messageId
    )
    saveMessages(threadId, messages)
  },

  getThreadAssistant(threadId: string): unknown | null {
    return getThreadAssistant(threadId)
  },

  createThreadAssistant(threadId: string, assistant: unknown): unknown {
    saveThreadAssistant(threadId, assistant)
    return assistant
  },

  modifyThreadAssistant(threadId: string, assistant: unknown): unknown {
    saveThreadAssistant(threadId, assistant)
    return assistant
  },
}
