export type ParamControllerType = 'slider' | 'input' | 'checkbox'

export type ParamCategory = 'general' | 'sampling' | 'penalties'

export interface ParamSetting {
  key: string
  value: number | boolean
  title: string
  description: string
  controllerType: ParamControllerType
  category: ParamCategory
  min?: number
  max?: number
  step?: number
}

/**
 * Canonical sampling / generation parameters surfaced in the Sampling popover
 * and the assistant editor. Keys map 1:1 onto the OpenAI-compatible request
 * body that local backends (llamacpp / llamacpp-upstream / mlx) accept — the
 * whole bag is injected verbatim into the request body (see ModelFactory).
 *
 * Shape kept backward-compatible: existing consumers only read `key`, `value`,
 * `title`; the extra metadata is additive.
 */
export const paramsSettings: Record<string, ParamSetting> = {
  stream: {
    key: 'stream',
    value: true,
    title: 'Stream',
    description: `Enables real-time response streaming.`,
    controllerType: 'checkbox',
    category: 'general',
  },
  temperature: {
    key: 'temperature',
    value: 0.7,
    title: 'Temperature',
    description: `Controls response randomness. Higher values produce more creative, varied responses.`,
    controllerType: 'slider',
    category: 'sampling',
    min: 0,
    max: 2,
    step: 0.1,
  },
  top_p: {
    key: 'top_p',
    value: 0.95,
    title: 'Top P',
    description: `Set probability threshold for more relevant outputs. Higher values allow more diverse word choices.`,
    controllerType: 'slider',
    category: 'sampling',
    min: 0,
    max: 1,
    step: 0.05,
  },
  top_k: {
    key: 'top_k',
    value: 40,
    title: 'Top K',
    description: `Limits sampling to the K most likely next tokens. Lower values make the output more focused.`,
    controllerType: 'slider',
    category: 'sampling',
    min: 0,
    max: 100,
    step: 1,
  },
  min_p: {
    key: 'min_p',
    value: 0.05,
    title: 'Min P',
    description: `Discards tokens whose probability is below this fraction of the most likely token. Higher values prune the long tail more aggressively.`,
    controllerType: 'slider',
    category: 'sampling',
    min: 0,
    max: 1,
    step: 0.01,
  },
  frequency_penalty: {
    key: 'frequency_penalty',
    value: 0.7,
    title: 'Frequency Penalty',
    description: `Reduces word repetition. Higher values encourage more varied language. Useful for creative writing and content generation.`,
    controllerType: 'slider',
    category: 'penalties',
    min: -2,
    max: 2,
    step: 0.1,
  },
  presence_penalty: {
    key: 'presence_penalty',
    value: 0.7,
    title: 'Presence Penalty',
    description: `Encourages the model to explore new topics. Higher values help prevent the model from fixating on already-discussed subjects.`,
    controllerType: 'slider',
    category: 'penalties',
    min: -2,
    max: 2,
    step: 0.1,
  },
  repeat_penalty: {
    key: 'repeat_penalty',
    value: 1.1,
    title: 'Repeat Penalty',
    description: `Penalizes tokens that have already appeared. 1.0 disables the penalty; higher values discourage repetition.`,
    controllerType: 'slider',
    category: 'penalties',
    min: 0,
    max: 2,
    step: 0.05,
  },
}

/** Ordered category metadata for grouping the controls in the UI. */
export const paramCategories: { id: ParamCategory; title: string }[] = [
  { id: 'sampling', title: 'Sampling' },
  { id: 'penalties', title: 'Penalties' },
  { id: 'general', title: 'General' },
]

/** Param keys, grouped and ordered by category, for the Sampling popover. */
export const paramGroups: Record<ParamCategory, string[]> = {
  sampling: ['temperature', 'top_p', 'top_k', 'min_p'],
  penalties: ['frequency_penalty', 'presence_penalty', 'repeat_penalty'],
  general: ['stream'],
}

/** Flat, ordered list of every sampling-related key surfaced in the popover. */
export const SAMPLING_PARAM_KEYS: string[] = paramCategories.flatMap(
  (category) => paramGroups[category.id]
)
