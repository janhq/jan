const fs = require('fs')
import { rimraf } from 'rimraf'
import { JanApiRouteConfiguration, RouteConfiguration } from '../index'
import { join } from 'path'
import { ThreadMessage } from '@janhq/core/dist/types/types'
import { ulid } from 'ulid'
const progress = require('request-progress')
import request from 'request'
const os = require('os')

const path = join(os.homedir(), 'jan')

export const getBuilder = async (configuration: RouteConfiguration) => {
  const directoryPath = join(path, configuration.dirName)

  try {
    if (!(await fs.existsSync(directoryPath))) {
      console.debug('model folder not found')
      return []
    }

    const files: string[] = await fs.readdirSync(directoryPath)

    const allDirectories: string[] = []
    for (const file of files) {
      if (!file.includes('.')) allDirectories.push(file)
    }

    const readJsonPromises = allDirectories.map((dirName) => {
      const jsonPath = join(
        directoryPath,
        dirName,
        configuration.metadataFileName
      )
      return readModelMetadata(jsonPath)
    })

    const results = await Promise.allSettled(readJsonPromises)
    const modelData = results
      .map((result) => {
        if (result.status === 'fulfilled') {
          try {
            return JSON.parse(result.value)
          } catch {
            return result.value
          }
        } else {
          console.error(result.reason)
          return undefined
        }
      })
      .filter((e) => !!e)

    return modelData
  } catch (err) {
    console.error(err)
    return []
  }
}

const readModelMetadata = (path: string) => {
  return fs.readFileSync(join(path))
}

export const retrieveBuilder = async (
  configuration: RouteConfiguration,
  id: string
) => {
  const data = await getBuilder(configuration)
  const filteredData = data.filter((d: any) => d.id === id)[0]

  if (!filteredData) {
    return {}
  }

  return filteredData
}

export const deleteBuilder = async (
  configuration: RouteConfiguration,
  id: string
) => {
  if (configuration.dirName === 'assistants' && id === 'jan') {
    return {
      message: 'Cannot delete Jan assistant',
    }
  }

  const directoryPath = join(path, configuration.dirName)
  try {
    const data = await retrieveBuilder(configuration, id)
    if (!data || !data.keys) {
      return {
        message: 'Not found',
      }
    }

    const myPath = join(directoryPath, id)
    rimraf.sync(myPath)
    return {
      id: id,
      object: configuration.delete.object,
      deleted: true,
    }
  } catch (ex) {
    console.error(ex)
  }
}

export const getMessages = async (threadId: string) => {
  const threadDirPath = join(path, 'threads', threadId)
  const messageFile = 'messages.jsonl'
  try {
    const files: string[] = await fs.readdirSync(threadDirPath)
    if (!files.includes(messageFile)) {
      throw Error(`${threadDirPath} not contains message file`)
    }

    const messageFilePath = join(threadDirPath, messageFile)

    const lines = fs
      .readFileSync(messageFilePath)
      .toString()
      .split('\n')
      .filter((line: any) => line !== '')

    const messages: ThreadMessage[] = []
    lines.forEach((line: string) => {
      messages.push(JSON.parse(line) as ThreadMessage)
    })
    return messages
  } catch (err) {
    console.error(err)
    return []
  }
}

export const retrieveMesasge = async (threadId: string, messageId: string) => {
  const messages = await getMessages(threadId)
  const filteredMessages = messages.filter((m) => m.id === messageId)
  if (!filteredMessages || filteredMessages.length === 0) {
    return {
      message: 'Not found',
    }
  }

  return filteredMessages[0]
}

export const createThread = async (thread: any) => {
  const threadMetadataFileName = 'thread.json'
  // TODO: add validation
  if (!thread.assistants || thread.assistants.length === 0) {
    return {
      message: 'Thread must have at least one assistant',
    }
  }

  const threadId = generateThreadId(thread.assistants[0].assistant_id)
  try {
    const updatedThread = {
      ...thread,
      id: threadId,
      created: Date.now(),
      updated: Date.now(),
    }
    const threadDirPath = join(path, 'threads', updatedThread.id)
    const threadJsonPath = join(threadDirPath, threadMetadataFileName)

    if (!fs.existsSync(threadDirPath)) {
      fs.mkdirSync(threadDirPath)
    }

    await fs.writeFileSync(
      threadJsonPath,
      JSON.stringify(updatedThread, null, 2)
    )
    return updatedThread
  } catch (err) {
    return {
      error: err,
    }
  }
}

export const updateThread = async (threadId: string, thread: any) => {
  const threadMetadataFileName = 'thread.json'
  const currentThreadData = await retrieveBuilder(
    JanApiRouteConfiguration.threads,
    threadId
  )
  if (!currentThreadData) {
    return {
      message: 'Thread not found',
    }
  }
  // we don't want to update the id and object
  delete thread.id
  delete thread.object

  const updatedThread = {
    ...currentThreadData,
    ...thread,
    updated: Date.now(),
  }
  try {
    const threadDirPath = join(path, 'threads', updatedThread.id)
    const threadJsonPath = join(threadDirPath, threadMetadataFileName)

    await fs.writeFileSync(
      threadJsonPath,
      JSON.stringify(updatedThread, null, 2)
    )
    return updatedThread
  } catch (err) {
    return {
      message: err,
    }
  }
}

const generateThreadId = (assistantId: string) => {
  return `${assistantId}_${(Date.now() / 1000).toFixed(0)}`
}

export const createMessage = async (threadId: string, message: any) => {
  const threadMessagesFileName = 'messages.jsonl'
  // TODO: add validation
  try {
    const msgId = ulid()
    const createdAt = Date.now()
    const threadMessage: ThreadMessage = {
      ...message,
      id: msgId,
      thread_id: threadId,
      created: createdAt,
      updated: createdAt,
      object: 'thread.message',
    }

    const threadDirPath = join(path, 'threads', threadId)
    const threadMessagePath = join(threadDirPath, threadMessagesFileName)

    if (!fs.existsSync(threadDirPath)) {
      fs.mkdirSync(threadDirPath)
    }
    fs.appendFileSync(threadMessagePath, JSON.stringify(threadMessage) + '\n')
    return threadMessage
  } catch (err) {
    return {
      message: err,
    }
  }
}

export const downloadModel = async (modelId: string) => {
  const model = await retrieveBuilder(JanApiRouteConfiguration.models, modelId)
  if (!model || model.object !== 'model') {
    return {
      message: 'Model not found',
    }
  }

  const directoryPath = join(path, 'models', modelId)
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath)
  }

  // path to model binary
  const modelBinaryPath = join(directoryPath, modelId)
  const rq = request(model.source_url)

  progress(rq, {})
    .on('progress', function (state: any) {
      console.log('progress', JSON.stringify(state, null, 2))
    })
    .on('error', function (err: Error) {
      console.error('error', err)
    })
    .on('end', function () {
      console.log('end')
    })
    .pipe(fs.createWriteStream(modelBinaryPath))

  return {
    message: `Starting download ${modelId}`,
  }
}
