import { PluginType, fs } from '@janhq/core'
import { ConversationalPlugin } from '@janhq/core/lib/plugins'
import { Thread, ThreadMessage } from '@janhq/core/lib/types'
import { join } from 'path'

/**
 * JSONConversationalPlugin is a ConversationalPlugin implementation that provides
 * functionality for managing threads.
 */
export default class JSONConversationalPlugin implements ConversationalPlugin {
  private static readonly _homeDir = 'threads'
  private static readonly _threadInfoFileName = 'thread.json'
  private static readonly _threadMessagesFileName = 'messages.jsonl'

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
  async getThreads(): Promise<Thread[]> {
    try {
      const threadDirs = await this.getValidThreadDirs()

      const promises = threadDirs.map((dirName) => this.readThread(dirName))
      const promiseResults = await Promise.allSettled(promises)
      const convos = promiseResults
        .map((result) => {
          if (result.status === 'fulfilled') {
            return JSON.parse(result.value) as Thread
          }
        })
        .filter((convo) => convo != null)
      convos.sort(
        (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
      )
      console.debug('getThreads', JSON.stringify(convos, null, 2))
      return convos
    } catch (error) {
      console.error(error)
      return []
    }
  }

  /**
   * Saves a Thread object to a json file.
   * @param thread The Thread object to save.
   */
  async saveThread(thread: Thread): Promise<void> {
    try {
      const threadDirPath = join(JSONConversationalPlugin._homeDir, thread.id)
      const threadJsonPath = join(
        threadDirPath,
        JSONConversationalPlugin._threadInfoFileName
      )
      await fs.mkdir(threadDirPath)
      await fs.writeFile(threadJsonPath, JSON.stringify(thread, null, 2))
      Promise.resolve()
    } catch (err) {
      Promise.reject(err)
    }
  }

  /**
   * Delete a thread with the specified ID.
   * @param threadId The ID of the thread to delete.
   */
  deleteThread(threadId: string): Promise<void> {
    return fs.rmdir(join(JSONConversationalPlugin._homeDir, `${threadId}`))
  }

  async addNewMessage(message: ThreadMessage): Promise<void> {
    try {
      const threadDirPath = join(
        JSONConversationalPlugin._homeDir,
        message.thread_id
      )
      const threadMessagePath = join(
        threadDirPath,
        JSONConversationalPlugin._threadMessagesFileName
      )
      await fs.mkdir(threadDirPath)
      await fs.appendFile(threadMessagePath, JSON.stringify(message) + '\n')
      Promise.resolve()
    } catch (err) {
      Promise.reject(err)
    }
  }

  /**
   * A promise builder for reading a thread from a file.
   * @param threadDirName the thread dir we are reading from.
   * @returns data of the thread
   */
  private async readThread(threadDirName: string): Promise<any> {
    return fs.readFile(
      join(
        JSONConversationalPlugin._homeDir,
        threadDirName,
        JSONConversationalPlugin._threadInfoFileName
      )
    )
  }

  /**
   * Returns a Promise that resolves to an array of thread directories.
   * @private
   */
  private async getValidThreadDirs(): Promise<string[]> {
    const fileInsideThread: string[] = await fs.listFiles(
      JSONConversationalPlugin._homeDir
    )

    const threadDirs: string[] = []
    for (let i = 0; i < fileInsideThread.length; i++) {
      const path = join(JSONConversationalPlugin._homeDir, fileInsideThread[i])
      const isDirectory = await fs.isDirectory(path)
      if (!isDirectory) {
        console.debug(`Ignore ${path} because it is not a directory`)
        continue
      }

      const isHavingThreadInfo = (await fs.listFiles(path)).includes(
        JSONConversationalPlugin._threadInfoFileName
      )
      if (!isHavingThreadInfo) {
        console.debug(`Ignore ${path} because it does not have thread info`)
        continue
      }

      threadDirs.push(fileInsideThread[i])
    }
    return threadDirs
  }

  async getAllMessages(threadId: string): Promise<ThreadMessage[]> {
    try {
      const threadDirPath = join(JSONConversationalPlugin._homeDir, threadId)
      const isDir = await fs.isDirectory(threadDirPath)
      if (!isDir) {
        throw Error(`${threadDirPath} is not directory`)
      }

      const files: string[] = await fs.listFiles(threadDirPath)
      if (!files.includes(JSONConversationalPlugin._threadMessagesFileName)) {
        throw Error(`${threadDirPath} not contains message file`)
      }

      const messageFilePath = join(
        threadDirPath,
        JSONConversationalPlugin._threadMessagesFileName
      )

      const result = await fs.readLineByLine(messageFilePath)

      const messages: ThreadMessage[] = []
      result.forEach((line: string) => {
        messages.push(JSON.parse(line) as ThreadMessage)
      })
      return messages
    } catch (err) {
      console.error(err)
      return []
    }
  }
}
