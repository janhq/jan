import { requestInference } from './helpers/sse'
import { ulid } from 'ulidx'
import { AIEngine } from './AIEngine'
import {
  ChatCompletionRole,
  ContentType,
  InferenceEvent,
  MessageEvent,
  MessageRequest,
  MessageRequestType,
  MessageStatus,
  Model,
  ModelInfo,
  ThreadContent,
  ThreadMessage,
} from '../../../types'
import { events } from '../../events'

/**
 * Base OAI Inference Provider
 * Applicable to all OAI compatible inference providers
 */
export abstract class OAIEngine extends AIEngine {
  // The inference engine
  abstract inferenceUrl: string

  // Controller to handle stop requests
  controller = new AbortController()
  isCancelled = false

  // The loaded model instance
  loadedModel: Model | undefined

  // Transform the payload
  transformPayload?: Function

  // Transform the response
  transformResponse?: Function

  /**
   * On extension load, subscribe to events.
   */
  override onLoad() {
    super.onLoad()
    events.on(MessageEvent.OnMessageSent, (data: MessageRequest) => this.inference(data))
    events.on(InferenceEvent.OnInferenceStopped, () => this.stopInference())
  }

  /**
   * On extension unload
   */
  override onUnload(): void {}

  /*
   * Inference request
   */
  override async inference(data: MessageRequest) {
    if (!data.model?.id) {
      events.emit(MessageEvent.OnMessageResponse, {
        status: MessageStatus.Error,
        content: [
          {
            type: ContentType.Text,
            text: {
              value: 'No model ID provided',
              annotations: [],
            },
          },
        ],
      })
      return
    }

    const timestamp = Date.now()
    const message: ThreadMessage = {
      id: ulid(),
      thread_id: data.threadId,
      type: data.type,
      assistant_id: data.assistantId,
      role: ChatCompletionRole.Assistant,
      content: [],
      status: MessageStatus.Pending,
      created: timestamp,
      updated: timestamp,
      object: 'thread.message',
    }

    if (data.type !== MessageRequestType.Summary) {
      events.emit(MessageEvent.OnMessageResponse, message)
    }

    this.isCancelled = false
    this.controller = new AbortController()

    const model: ModelInfo = {
      ...(this.loadedModel ? this.loadedModel : {}),
      ...data.model,
    }

    const header = await this.headers()
    let requestBody = {
      messages: data.messages ?? [],
      model: model.id,
      stream: true,
      ...model.parameters,
    }
    if (this.transformPayload) {
      requestBody = this.transformPayload(requestBody)
    }

    requestInference(
      this.inferenceUrl,
      requestBody,
      model,
      this.controller,
      header,
      this.transformResponse
    ).subscribe({
      next: (content: any) => {
        const messageContent: ThreadContent = {
          type: ContentType.Text,
          text: {
            value: content.trim(),
            annotations: [],
          },
        }
        message.content = [messageContent]
        events.emit(MessageEvent.OnMessageUpdate, message)
      },
      complete: async () => {
        message.status = message.content.length ? MessageStatus.Ready : MessageStatus.Error
        events.emit(MessageEvent.OnMessageUpdate, message)
      },
      error: async (err: any) => {
        console.debug('inference url: ', this.inferenceUrl)
        console.debug('header: ', header)
        console.error(`Inference error:`, JSON.stringify(err))
        if (this.isCancelled || message.content.length) {
          message.status = MessageStatus.Stopped
          events.emit(MessageEvent.OnMessageUpdate, message)
          return
        }
        message.status = MessageStatus.Error
        message.content[0] = {
          type: ContentType.Text,
          text: {
            value: err.message,
            annotations: [],
          },
        }
        message.error_code = err.code
        events.emit(MessageEvent.OnMessageUpdate, message)
      },
    })
  }

  /**
   * Stops the inference.
   */
  override stopInference() {
    this.isCancelled = true
    this.controller?.abort()
  }

  /**
   * Headers for the inference request
   */
  async headers(): Promise<HeadersInit> {
    return {}
  }
}
