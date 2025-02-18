import { InferenceEngine } from '../../types'

export type Engines = {
  [key in InferenceEngine]: (EngineVariant & EngineConfig)[]
}

export type EngineMetadata = {
  get_models_url?: string
  header_template?: string
  transform_req?: {
    chat_completions?: {
      url?: string
      template?: string
    }
  }
  transform_resp?: {
    chat_completions?: {
      template?: string
    }
  }
  explore_models_url?: string
}

export type EngineVariant = {
  engine: InferenceEngine
  name: string
  version: string
}

export type DefaultEngineVariant = {
  engine: InferenceEngine
  variant: string
  version: string
}

export type EngineReleased = {
  created_at: string
  download_count: number
  name: string
  size: number
}

export type EngineConfig = {
  engine?: string
  version?: string
  variant?: string
  type?: string
  url?: string
  api_key?: string
  metadata?: EngineMetadata
}

export enum EngineEvent {
  OnEngineUpdate = 'OnEngineUpdate',
}
