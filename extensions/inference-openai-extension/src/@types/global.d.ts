declare const MODULE: string
declare const OPENAI_DOMAIN: string

declare interface EngineSettings {
  full_url?: string
  api_key?: string
}

enum OpenAIChatCompletionModelName {
  'gpt-3.5-turbo-instruct' = 'gpt-3.5-turbo-instruct',
  'gpt-3.5-turbo-instruct-0914' = 'gpt-3.5-turbo-instruct-0914',
  'gpt-4-1106-preview' = 'gpt-4-1106-preview',
  'gpt-3.5-turbo-0613' = 'gpt-3.5-turbo-0613',
  'gpt-3.5-turbo-0301' = 'gpt-3.5-turbo-0301',
  'gpt-3.5-turbo' = 'gpt-3.5-turbo',
  'gpt-3.5-turbo-16k-0613' = 'gpt-3.5-turbo-16k-0613',
  'gpt-3.5-turbo-1106' = 'gpt-3.5-turbo-1106',
  'gpt-4-vision-preview' = 'gpt-4-vision-preview',
  'gpt-4' = 'gpt-4',
  'gpt-4-0314' = 'gpt-4-0314',
  'gpt-4-0613' = 'gpt-4-0613',
}

declare type OpenAIModel = Omit<Model, 'id'> & {
  id: OpenAIChatCompletionModelName
}
