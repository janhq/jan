import { InferenceEngine } from '../../types'

export type Engines = {
  [key in InferenceEngine]: EngineVariant[]
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

export enum EngineEvent {
  OnEngineUpdate = 'OnEngineUpdate',
}
