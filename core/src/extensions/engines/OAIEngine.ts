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
} from '../../types'
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
  override inference(data: MessageRequest) {
    if (data.model?.engine?.toString() !== this.provider) return

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

    requestInference(
      this.inferenceUrl,
      data.messages ?? [],
      model,
      this.controller,
      this.headers()
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
        if (this.isCancelled || message.content.length) {
          message.status = MessageStatus.Stopped
          events.emit(MessageEvent.OnMessageUpdate, message)
          return
        }
        message.status = MessageStatus.Error
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
  headers(): HeadersInit {
    return {}
  }
}
