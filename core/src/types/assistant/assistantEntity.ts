import {
  AssistantTool as OpenAiAssistantTool,
  Assistant as OpenAiAssistant,
  AssistantCreateParams as OpenAiAssistantCreateParams,
  AssistantUpdateParams as OpenAiAssistantUpdateParams,
} from 'openai/resources/beta/assistants'
import { AssistantResponseFormatOption as OpenAIAssistantResponseFormatOption } from 'openai/resources/beta/threads/threads'

export interface Assistant extends OpenAiAssistant {
  avatar?: string

  tools: AssistantTool[]
}

export type AssistantResponseFormatOption = OpenAIAssistantResponseFormatOption

export interface AssistantToolResources extends OpenAiAssistant.ToolResources {}

export type AssistantTool = OpenAiAssistantTool & {
  enabled?: boolean

  useTimeWeightedRetriever?: boolean
}

export interface AssistantCreateParams extends OpenAiAssistantCreateParams {}

export interface AssistantUpdateParams extends OpenAiAssistantUpdateParams {}
