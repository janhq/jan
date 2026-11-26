/**
 * What a model of a contributed provider can do, as the host reads it:
 * `tools` turns on tool calling in chat, `vision`, `audio` and `video` allow
 * those attachments, `embeddings` marks a model for embedding rather than
 * chat, `reasoning` labels a thinking model. A model with none declared is
 * `['completion']`.
 */
export type ModelCapability =
  | 'completion'
  | 'tools'
  | 'vision'
  | 'audio'
  | 'video'
  | 'embeddings'
  | 'reasoning'

/** Every `ModelCapability`; anything else is rejected, not ignored. */
export const MODEL_CAPABILITIES: readonly ModelCapability[] = [
  'completion',
  'tools',
  'vision',
  'audio',
  'video',
  'embeddings',
  'reasoning',
]

/** What a model gets when neither its provider nor its listing says. */
export const DEFAULT_MODEL_CAPABILITIES: readonly ModelCapability[] = [
  'completion',
]

/** Narrows a manifest or `listModels` entry to a `ModelCapability`. */
export function isModelCapability(value: unknown): value is ModelCapability {
  return MODEL_CAPABILITIES.includes(value as ModelCapability)
}
