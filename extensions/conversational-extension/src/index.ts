import {
  ExtensionType,
  fs,
  ConversationalExtension,
  Thread,
  ThreadMessage,
} from '@janhq/core'
import { join } from 'path'

/**
 * JSONConversationalExtension is a ConversationalExtension implementation that provides
 * functionality for managing threads.
 */
export default class JSONConversationalExtension
  implements ConversationalExtension
{
  private static readonly _homeDir = 'threads'
  private static readonly _threadInfoFileName = 'thread.json'
  private static readonly _threadMessagesFileName = 'messages.jsonl'

  /**
   * Returns the type of the extension.
   */
  type(): ExtensionType {
    return ExtensionType.Conversational
  }

  /**
   * Called when the extension is loaded.
   */
  onLoad() {
    fs.mkdir(JSONConversationalExtension._homeDir)
    console.debug('JSONConversationalExtension loaded')
  }

  /**
   * Called when the extension is unloaded.
   */
  onUnload() {
    console.debug('JSONConversationalExtension unloaded')
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
      const threadDirPath = join(
        JSONConversationalExtension._homeDir,
        thread.id
      )
      const threadJsonPath = join(
        threadDirPath,
        JSONConversationalExtension._threadInfoFileName
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
    return fs.rmdir(join(JSONConversationalExtension._homeDir, `${threadId}`))
  }

  async addNewMessage(message: ThreadMessage): Promise<void> {
    try {
      const threadDirPath = join(
        JSONConversationalExtension._homeDir,
        message.thread_id
      )
      const threadMessagePath = join(
        threadDirPath,
        JSONConversationalExtension._threadMessagesFileName
      )
      await fs.mkdir(threadDirPath)

      if (message.content[0].type === 'image') {
        const filesPath = join(threadDirPath, 'files')
        await fs.mkdir(filesPath)

        const imagePath = join(filesPath, `${message.id}.png`)
        const base64 = message.content[0].text.annotations[0]
        await this.storeImage(base64, imagePath)
      }

      await fs.appendFile(threadMessagePath, JSON.stringify(message) + '\n')
      Promise.resolve()
    } catch (err) {
      Promise.reject(err)
    }
  }

  async storeImage(base64: string, filePath: string): Promise<void> {
    const base64Data = base64.replace(/^data:image\/\w+;base64,/, '')

    try {
      await fs.writeBlob(filePath, base64Data)
    } catch (err) {
      console.error(err)
    }
  }

  async writeMessages(
    threadId: string,
    messages: ThreadMessage[]
  ): Promise<void> {
    try {
      const threadDirPath = join(JSONConversationalExtension._homeDir, threadId)
      const threadMessagePath = join(
        threadDirPath,
        JSONConversationalExtension._threadMessagesFileName
      )
      await fs.mkdir(threadDirPath)
      await fs.writeFile(
        threadMessagePath,
        messages.map((msg) => JSON.stringify(msg)).join('\n') +
          (messages.length ? '\n' : '')
      )
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
        JSONConversationalExtension._homeDir,
        threadDirName,
        JSONConversationalExtension._threadInfoFileName
      )
    )
  }

  /**
   * Returns a Promise that resolves to an array of thread directories.
   * @private
   */
  private async getValidThreadDirs(): Promise<string[]> {
    const fileInsideThread: string[] = await fs.listFiles(
      JSONConversationalExtension._homeDir
    )

    const threadDirs: string[] = []
    for (let i = 0; i < fileInsideThread.length; i++) {
      const path = join(
        JSONConversationalExtension._homeDir,
        fileInsideThread[i]
      )
      const isDirectory = await fs.isDirectory(path)
      if (!isDirectory) {
        console.debug(`Ignore ${path} because it is not a directory`)
        continue
      }

      const isHavingThreadInfo = (await fs.listFiles(path)).includes(
        JSONConversationalExtension._threadInfoFileName
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
      const threadDirPath = join(JSONConversationalExtension._homeDir, threadId)
      const isDir = await fs.isDirectory(threadDirPath)
      if (!isDir) {
        throw Error(`${threadDirPath} is not directory`)
      }

      const files: string[] = await fs.listFiles(threadDirPath)
      if (
        !files.includes(JSONConversationalExtension._threadMessagesFileName)
      ) {
        throw Error(`${threadDirPath} not contains message file`)
      }

      const messageFilePath = join(
        threadDirPath,
        JSONConversationalExtension._threadMessagesFileName
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
