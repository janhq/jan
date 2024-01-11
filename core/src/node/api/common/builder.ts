import fs from 'fs'
import { JanApiRouteConfiguration, RouteConfiguration } from './configuration'
import { join } from 'path'
import { ContentType, MessageStatus, Model, ThreadMessage } from './../../../index'

const os = require('os')

const path = join(os.homedir(), 'jan')

export const getBuilder = async (configuration: RouteConfiguration) => {
  const directoryPath = join(path, configuration.dirName)
  try {
    if (!fs.existsSync(directoryPath)) {
      console.debug('model folder not found')
      return []
    }

    const files: string[] = fs.readdirSync(directoryPath)

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
  if (fs.existsSync(path)) {
    return fs.readFileSync(path, 'utf-8')
  } else {
    return undefined
  }
}

export const retrieveBuilder = async (configuration: RouteConfiguration, id: string) => {
  const data = await getBuilder(configuration)
  const filteredData = data.filter((d: any) => d.id === id)[0]

  if (!filteredData) {
    return {}
  }

  return filteredData
}

export const deleteBuilder = async (configuration: RouteConfiguration, id: string) => {
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
    fs.rmdirSync(myPath, { recursive: true })
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
    const files: string[] = fs.readdirSync(threadDirPath)
    if (!files.includes(messageFile)) {
      throw Error(`${threadDirPath} not contains message file`)
    }

    const messageFilePath = join(threadDirPath, messageFile)

    const lines = fs
      .readFileSync(messageFilePath, 'utf-8')
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

    await fs.writeFileSync(threadJsonPath, JSON.stringify(updatedThread, null, 2))
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
    const threadDirPath = join(path, 'threads', updatedThread.id)
    const threadJsonPath = join(threadDirPath, threadMetadataFileName)

    await fs.writeFileSync(threadJsonPath, JSON.stringify(updatedThread, null, 2))
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
    const { ulid } = require('ulid')
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

  const request = require('request')
  const rq = request(model.source_url)
  const progress = require('request-progress')
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

export const chatCompletions = async (request: any, reply: any) => {
  const modelList = await getBuilder(JanApiRouteConfiguration.models)
  const modelId = request.body.model

  const matchedModels = modelList.filter((model: Model) => model.id === modelId)
  if (matchedModels.length === 0) {
    const error = {
      error: {
        message: `The model ${request.body.model} does not exist`,
        type: 'invalid_request_error',
        param: null,
        code: 'model_not_found',
      },
    }
    reply.code(404).send(error)
    return
  }

  const requestedModel = matchedModels[0]
  const engineConfiguration = await getEngineConfiguration(requestedModel.engine)

  let apiKey: string | undefined = undefined
  let apiUrl: string = 'http://127.0.0.1:3928/inferences/llamacpp/chat_completion' // default nitro url

  if (engineConfiguration) {
    apiKey = engineConfiguration.api_key
    apiUrl = engineConfiguration.full_url
  }

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const headers: Record<string, any> = {
    'Content-Type': 'application/json',
  }

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
    headers['api-key'] = apiKey
  }
  console.debug(apiUrl)
  console.debug(JSON.stringify(headers))
  const fetch = require('node-fetch')
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(request.body),
  })
  if (response.status !== 200) {
    console.error(response)
    return
  } else {
    response.body.pipe(reply.raw)
  }
}

const getEngineConfiguration = async (engineId: string) => {
  if (engineId !== 'openai') {
    return undefined
  }
  const directoryPath = join(path, 'engines')
  const filePath = join(directoryPath, `${engineId}.json`)
  const data = await fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(data)
}
