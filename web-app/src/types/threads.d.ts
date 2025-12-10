/**
 * The content type of the message.
 */
type ContentType = 'text' | 'image_url'

/**
 * The `ContentValue` type defines the shape of a content value object
 * @data_transfer_object
 */
type ContentValue = {
  value: string
  annotations: string[]
}

/**
 * The `ImageContentValue` type defines the shape of a content value object of image type
 * @data_transfer_object
 */
type ImageContentValue = {
  detail?: string
  url?: string
}

type ThreadContent = {
  type: ContentType
  text?: ContentValue
  image_url?: ImageContentValue
  role: ChatCompletionRole
}

type ChatCompletionRole = 'system' | 'assistant' | 'user' | 'tool'

type ThreadModel = {
  id: string
  provider: string
}

type Thread = {
  assistants?: ThreadAssistantInfo[]
  id: string
  title: string
  isFavorite?: boolean

  model?: ThreadModel
  updated: number
  order?: number
  metadata?: {
    project?: {
      id: string
      name: string
      updated_at: number
    }
    [key: string]: unknown
  }
}

type Assistant = {
  avatar?: string
  id: string
  name: string
  created_at: number
  description?: string
  instructions: string
  parameters: Record<string, unknown>
  // tool_steps?: number
}

type TokenSpeed = {
  message: string
  tokenSpeed: number
  tokenCount: number
  lastTimestamp: number
}
