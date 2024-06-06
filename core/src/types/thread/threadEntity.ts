import { Thread as OpenAiThread } from 'openai/resources/beta/threads/threads'
import { Assistant } from '../assistant'

export interface ThreadToolResources extends OpenAiThread.ToolResources {}

export interface Thread extends OpenAiThread {
  title: string

  assistants: Assistant[]

  tool_resources: ThreadToolResources | null
}
