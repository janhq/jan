import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  createWriteStream,
} from 'fs'
import { JanApiRouteConfiguration, RouteConfiguration } from './configuration'
import { join } from 'path'
import { ContentType, InferenceEngine, MessageStatus, ThreadMessage } from '../../../../types'
import { getJanDataFolderPath } from '../../../helper'
import { CORTEX_API_URL } from './consts'

// TODO: Refactor these
export const getBuilder = async (configuration: RouteConfiguration) => {
  const directoryPath = join(getJanDataFolderPath(), configuration.dirName)
  try {
    if (!existsSync(directoryPath)) {
      console.debug('model folder not found')
      return []
    }

    const files: string[] = readdirSync(directoryPath)

    const allDirectories: string[] = []
    for (const file of files) {
      if (file === '.DS_Store') continue
      allDirectories.push(file)
    }

    const results = allDirectories
      .map((dirName) => {
        const jsonPath = join(directoryPath, dirName, configuration.metadataFileName)
        return readModelMetadata(jsonPath)
      })
      .filter((data) => !!data)
    const modelData = results
      .map((result: any) => {
        try {
          return JSON.parse(result)
        } catch (err) {
          console.error(err)
        }
      })
      .filter((e: any) => !!e)

    return modelData
  } catch (err) {
    console.error(err)
    return []
  }
}

const readModelMetadata = (path: string): string | undefined => {
  if (existsSync(path)) {
    return readFileSync(path, 'utf-8')
  } else {
    return undefined
  }
}

export const retrieveBuilder = async (configuration: RouteConfiguration, id: string) => {
  const data = await getBuilder(configuration)
  const filteredData = data.filter((d: any) => d.id === id)[0]

  if (!filteredData) {
    return undefined
  }

  return filteredData
}

export const getMessages = async (threadId: string): Promise<ThreadMessage[]> => {
  const threadDirPath = join(getJanDataFolderPath(), 'threads', threadId)
  const messageFile = 'messages.jsonl'
  try {
    const files: string[] = readdirSync(threadDirPath)
    if (!files.includes(messageFile)) {
      console.error(`${threadDirPath} not contains message file`)
      return []
    }

    const messageFilePath = join(threadDirPath, messageFile)
    if (!existsSync(messageFilePath)) {
      console.debug('message file not found')
      return []
    }

    const lines = readFileSync(messageFilePath, 'utf-8')
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

export const retrieveMessage = async (threadId: string, messageId: string) => {
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

  const threadId = generateThreadId(thread.assistants[0]?.assistant_id)
  try {
    const updatedThread = {
      ...thread,
      id: threadId,
      created: Date.now(),
      updated: Date.now(),
    }
    const threadDirPath = join(getJanDataFolderPath(), 'threads', updatedThread.id)
    const threadJsonPath = join(threadDirPath, threadMetadataFileName)

    if (!existsSync(threadDirPath)) {
      mkdirSync(threadDirPath)
    }

    await writeFileSync(threadJsonPath, JSON.stringify(updatedThread, null, 2))
    return updatedThread
  } catch (err) {
    return {
      error: err,
    }
  }
}

export const updateThread = async (threadId: string, thread: any) => {
  const threadMetadataFileName = 'thread.json'
  const currentThreadData = await retrieveBuilder(JanApiRouteConfiguration.threads, threadId)
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
    const threadDirPath = join(getJanDataFolderPath(), 'threads', updatedThread.id)
    const threadJsonPath = join(threadDirPath, threadMetadataFileName)

    await writeFileSync(threadJsonPath, JSON.stringify(updatedThread, null, 2))
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

  try {
    const { ulid } = require('ulidx')
    const msgId = ulid()
    const createdAt = Date.now()
    const threadMessage: ThreadMessage = {
      id: msgId,
      thread_id: threadId,
      status: MessageStatus.Ready,
      created: createdAt,
      updated: createdAt,
      object: 'thread.message',
      role: message.role,
      content: [
        {
          type: ContentType.Text,
          text: {
            value: message.content,
            annotations: [],
          },
        },
      ],
    }

    const threadDirPath = join(getJanDataFolderPath(), 'threads', threadId)
    const threadMessagePath = join(threadDirPath, threadMessagesFileName)

    if (!existsSync(threadDirPath)) {
      mkdirSync(threadDirPath)
    }
    appendFileSync(threadMessagePath, JSON.stringify(threadMessage) + '\n')
    return threadMessage
  } catch (err) {
    return {
      message: err,
    }
  }
}

export const downloadModel = async (
  modelId: string,
  network?: { proxy?: string; ignoreSSL?: boolean }
) => {
  const strictSSL = !network?.ignoreSSL
  const proxy = network?.proxy?.startsWith('http') ? network.proxy : undefined
  const model = await retrieveBuilder(JanApiRouteConfiguration.models, modelId)
  if (!model || model.object !== 'model') {
    return {
      message: 'Model not found',
    }
  }

  const directoryPath = join(getJanDataFolderPath(), 'models', modelId)
  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath)
  }

  // path to model binary
  const modelBinaryPath = join(directoryPath, modelId)

  const request = require('request')
  const progress = require('request-progress')

  for (const source of model.sources) {
    const rq = request({ url: source, strictSSL, proxy })
    progress(rq, {})
      ?.on('progress', function (state: any) {
        console.debug('progress', JSON.stringify(state, null, 2))
      })
      ?.on('error', function (err: Error) {
        console.error('error', err)
      })
      ?.on('end', function () {
        console.debug('end')
      })
      .pipe(createWriteStream(modelBinaryPath))
  }

  return {
    message: `Starting download ${modelId}`,
  }
}

/**
 * Proxy /models to cortex
 * @param request
 * @param reply
 */
export const models = async (request: any, reply: any) => {
  const fetch = require('node-fetch')
  const headers: Record<string, any> = {
    'Content-Type': 'application/json',
  }

  const response = await fetch(`${CORTEX_API_URL}/models${request.url.split('/models')[1] ?? ''}`, {
    method: request.method,
    headers: headers,
    body: JSON.stringify(request.body),
  })

  if (response.status !== 200) {
    // Forward the error response to client via reply
    const responseBody = await response.text()
    const responseHeaders = Object.fromEntries(response.headers)
    reply.code(response.status).headers(responseHeaders).send(responseBody)
  } else {
    reply.raw.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })
    response.body.pipe(reply.raw)
  }
}

/**
 * Proxy chat completions
 * @param request
 * @param reply
 */
export const chatCompletions = async (request: any, reply: any) => {
  const headers: Record<string, any> = {
    'Content-Type': 'application/json',
  }

  // add engine for new cortex cpp engine
  if (request.body.engine === InferenceEngine.nitro) {
    request.body.engine = InferenceEngine.cortex_llamacpp
  }

  const fetch = require('node-fetch')
  const response = await fetch(`${CORTEX_API_URL}/chat/completions`, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(request.body),
  })
  if (response.status !== 200) {
    // Forward the error response to client via reply
    const responseBody = await response.text()
    const responseHeaders = Object.fromEntries(response.headers)
    reply.code(response.status).headers(responseHeaders).send(responseBody)
  } else {
    reply.raw.writeHead(200, {
      'Content-Type': request.body.stream === true ? 'text/event-stream' : 'application/json',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })
    response.body.pipe(reply.raw)
  }
}
