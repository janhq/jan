declare const MODULE: string
declare const GROQ_DOMAIN: string

declare interface EngineSettings {
  full_url?: string
  api_key?: string
}

enum GroqChatCompletionModelName {
  'mixtral-8x7b-32768' = 'mixtral-8x7b-32768',
  'llama2-70b-4096' = 'llama2-70b-4096',
}

declare type GroqModel = Omit<Model, 'id'> & {
  id: GroqChatCompletionModelName
}
