/**
 * Sampling-parameter schema.
 *
 * Each ParamDef carries enough metadata for the UI to render the right
 * widget, validate values in isolation, and reason about mutual-exclusion
 * with other params (e.g. mirostat overrides top_k/top_p). Provider
 * applicability is expressed through `capability`, not provider IDs, so
 * provider-capability mapping lives in one place (resolveProviderCaps).
 */

export type ParamControllerType =
  | 'slider'
  | 'input'
  | 'checkbox'
  | 'dropdown'
  | 'textarea'

export type SamplerCap =
  | 'core'
  | 'penalties'
  | 'top_k'
  | 'min_p'
  | 'repetition'
  | 'mirostat'
  | 'dry'
  | 'xtc'
  | 'dynatemp'
  | 'typical_p'
  | 'top_n_sigma'
  | 'grammar'
  | 'json_schema'
  | 'ignore_eos'
  | 'client_only'

export interface ParamControllerProps {
  min?: number
  max?: number
  step?: number
  /** Values strictly greater than this render as a "warn" segment. */
  warnAbove?: number
  /** Values strictly less than this render as a "warn" segment. */
  warnBelow?: number
  placeholder?: string
  rows?: number
  options?: Array<{ value: number | string; name: string }>
}

export interface ParamDef {
  key: string
  title: string
  description: string
  /** Default value; type witness for the param. */
  value: string | number | boolean
  controllerType: ParamControllerType
  controllerProps?: ParamControllerProps
  /** Drives provider gating and outbound filtering. */
  capability: SamplerCap
  /**
   * Returns a short human reason when this param should be disabled given
   * the other current values (e.g. "Controlled by Mirostat"), else null.
   */
  disabledBy?: (vals: Record<string, unknown>) => string | null
  /** Plain-English one-liner shown under the control. */
  effectHint?: string
}

export const paramsSettings: Record<string, ParamDef> = {
  stream: {
    key: 'stream',
    title: 'Stream',
    description: 'Enables real-time response streaming.',
    value: true,
    controllerType: 'checkbox',
    capability: 'core',
  },
  max_context_tokens: {
    key: 'max_context_tokens',
    title: 'Max Context Tokens',
    description:
      'Total token budget (input + output). Older messages are trimmed/compacted to stay within this. 0 disables trimming.',
    value: 0,
    controllerType: 'input',
    controllerProps: { min: 0, step: 1 },
    capability: 'client_only',
  },
  max_output_tokens: {
    key: 'max_output_tokens',
    title: 'Max Output Tokens',
    description:
      'Maximum tokens the model may generate in one reply. Sent as max_tokens to OpenAI-compatible APIs.',
    value: 2048,
    controllerType: 'input',
    controllerProps: { min: 0, step: 1 },
    capability: 'core',
  },
  auto_compact: {
    key: 'auto_compact',
    title: 'Auto Compact',
    description:
      'When context limit is reached, summarize older messages instead of dropping them. Requires Max Context Tokens to be set.',
    value: false,
    controllerType: 'checkbox',
    capability: 'client_only',
  },
  temperature: {
    key: 'temperature',
    title: 'Temperature',
    description: 'Controls response randomness.',
    value: 0.8,
    controllerType: 'slider',
    controllerProps: { min: 0, max: 2, step: 0.05, warnAbove: 1.5 },
    capability: 'core',
    effectHint: 'Higher = more varied; 0 = deterministic.',
  },
  top_p: {
    key: 'top_p',
    title: 'Top P',
    description:
      'Nucleus sampling threshold. Higher values allow more diverse word choices.',
    value: 0.95,
    controllerType: 'slider',
    controllerProps: { min: 0, max: 1, step: 0.01 },
    capability: 'core',
    disabledBy: (v) =>
      Number(v.temperature) === 0
        ? 'Ignored when Temperature is 0'
        : Number(v.mirostat) > 0
          ? 'Controlled by Mirostat'
          : null,
  },
  top_k: {
    key: 'top_k',
    title: 'Top K',
    description: 'Sample from the top K most likely tokens. 0 = disabled.',
    value: 40,
    controllerType: 'slider',
    controllerProps: { min: 0, max: 200, step: 1 },
    capability: 'top_k',
    disabledBy: (v) =>
      Number(v.temperature) === 0
        ? 'Ignored when Temperature is 0'
        : Number(v.mirostat) > 0
          ? 'Controlled by Mirostat'
          : null,
  },
  min_p: {
    key: 'min_p',
    title: 'Min P',
    description: 'Minimum relative probability for a token to be considered.',
    value: 0.05,
    controllerType: 'slider',
    controllerProps: { min: 0, max: 1, step: 0.01 },
    capability: 'min_p',
    disabledBy: (v) =>
      Number(v.mirostat) > 0 ? 'Controlled by Mirostat' : null,
  },
  frequency_penalty: {
    key: 'frequency_penalty',
    title: 'Frequency Penalty',
    description: 'Reduces word repetition based on prior frequency.',
    value: 0,
    controllerType: 'slider',
    controllerProps: { min: -2, max: 2, step: 0.05, warnAbove: 1.5 },
    capability: 'penalties',
  },
  presence_penalty: {
    key: 'presence_penalty',
    title: 'Presence Penalty',
    description: 'Encourages the model to introduce new topics.',
    value: 0,
    controllerType: 'slider',
    controllerProps: { min: -2, max: 2, step: 0.05, warnAbove: 1.5 },
    capability: 'penalties',
  },
  repeat_penalty: {
    key: 'repeat_penalty',
    title: 'Repeat Penalty',
    description:
      'llama.cpp-style multiplicative penalty for repeated tokens. 1.0 = disabled.',
    value: 1.0,
    controllerType: 'slider',
    controllerProps: { min: 1, max: 2, step: 0.01, warnAbove: 1.3 },
    capability: 'repetition',
  },
  mirostat: {
    key: 'mirostat',
    title: 'Mirostat',
    description: 'Adaptive perplexity-targeting sampler.',
    value: 0,
    controllerType: 'dropdown',
    controllerProps: {
      options: [
        { value: 0, name: 'Off' },
        { value: 1, name: 'v1' },
        { value: 2, name: 'v2' },
      ],
    },
    capability: 'mirostat',
    effectHint: 'When enabled, overrides Top K / Top P / Min P.',
  },
  mirostat_tau: {
    key: 'mirostat_tau',
    title: 'Mirostat Tau',
    description: 'Target entropy. Lower = more focused.',
    value: 5.0,
    controllerType: 'slider',
    controllerProps: { min: 0, max: 10, step: 0.1 },
    capability: 'mirostat',
    disabledBy: (v) =>
      Number(v.mirostat) === 0 ? 'Enable Mirostat to use' : null,
  },
  mirostat_eta: {
    key: 'mirostat_eta',
    title: 'Mirostat Eta',
    description: 'Mirostat learning rate.',
    value: 0.1,
    controllerType: 'slider',
    controllerProps: { min: 0, max: 1, step: 0.01 },
    capability: 'mirostat',
    disabledBy: (v) =>
      Number(v.mirostat) === 0 ? 'Enable Mirostat to use' : null,
  },
  grammar: {
    key: 'grammar',
    title: 'Grammar (GBNF)',
    description: 'GBNF grammar to constrain generations.',
    value: '',
    controllerType: 'textarea',
    controllerProps: { rows: 4, placeholder: 'root ::= ...' },
    capability: 'grammar',
  },
  json_schema: {
    key: 'json_schema',
    title: 'JSON Schema',
    description: 'JSON schema constraining the output to valid JSON.',
    value: '',
    controllerType: 'textarea',
    controllerProps: { rows: 4, placeholder: '{"type":"object", ...}' },
    capability: 'json_schema',
  },
  typical_p: {
    key: 'typical_p',
    title: 'Typical P',
    description: 'Locally-typical sampling. 1.0 = disabled.',
    value: 1.0,
    controllerType: 'slider',
    controllerProps: { min: 0, max: 1, step: 0.01 },
    capability: 'typical_p',
  },
  top_n_sigma: {
    key: 'top_n_sigma',
    title: 'Top N Sigma',
    description: 'Filter by standard deviations above the max logit. -1 = off.',
    value: -1.0,
    controllerType: 'slider',
    controllerProps: { min: -1, max: 10, step: 0.1 },
    capability: 'top_n_sigma',
  },
  dynatemp_range: {
    key: 'dynatemp_range',
    title: 'Dynamic Temperature Range',
    description:
      'Effective temperature is sampled in [temperature - range, temperature + range]. 0 = off.',
    value: 0.0,
    controllerType: 'slider',
    controllerProps: { min: 0, max: 2, step: 0.05 },
    capability: 'dynatemp',
  },
  dynatemp_exp: {
    key: 'dynatemp_exp',
    title: 'Dynamic Temperature Exponent',
    description: 'Shapes the temperature distribution within the range.',
    value: 1.0,
    controllerType: 'slider',
    controllerProps: { min: 0, max: 5, step: 0.1 },
    capability: 'dynatemp',
    disabledBy: (v) =>
      Number(v.dynatemp_range) === 0 ? 'Set Dynamic Temperature Range > 0' : null,
  },
  xtc_probability: {
    key: 'xtc_probability',
    title: 'XTC Probability',
    description: 'Probability of activating the Exclude-Top-Choices sampler.',
    value: 0.0,
    controllerType: 'slider',
    controllerProps: { min: 0, max: 1, step: 0.01 },
    capability: 'xtc',
  },
  xtc_threshold: {
    key: 'xtc_threshold',
    title: 'XTC Threshold',
    description: 'Minimum token probability to be eligible for XTC exclusion.',
    value: 0.1,
    controllerType: 'slider',
    controllerProps: { min: 0, max: 1, step: 0.01 },
    capability: 'xtc',
    disabledBy: (v) =>
      Number(v.xtc_probability) === 0 ? 'Set XTC Probability > 0' : null,
  },
  dry_multiplier: {
    key: 'dry_multiplier',
    title: 'DRY Multiplier',
    description:
      "Don't-Repeat-Yourself penalty multiplier. 0 = disabled.",
    value: 0.0,
    controllerType: 'slider',
    controllerProps: { min: 0, max: 5, step: 0.1 },
    capability: 'dry',
  },
  dry_base: {
    key: 'dry_base',
    title: 'DRY Base',
    description: 'Exponential base for penalty growth.',
    value: 1.75,
    controllerType: 'slider',
    controllerProps: { min: 1, max: 4, step: 0.05 },
    capability: 'dry',
    disabledBy: (v) =>
      Number(v.dry_multiplier) === 0 ? 'Set DRY Multiplier > 0' : null,
  },
  dry_allowed_length: {
    key: 'dry_allowed_length',
    title: 'DRY Allowed Length',
    description: 'Minimum repeated-sequence length before DRY engages.',
    value: 2,
    controllerType: 'slider',
    controllerProps: { min: 1, max: 20, step: 1 },
    capability: 'dry',
    disabledBy: (v) =>
      Number(v.dry_multiplier) === 0 ? 'Set DRY Multiplier > 0' : null,
  },
  dry_penalty_last_n: {
    key: 'dry_penalty_last_n',
    title: 'DRY Penalty Window',
    description: 'Recent-token window DRY scans. -1 = full context, 0 = off.',
    value: -1,
    controllerType: 'input',
    controllerProps: { min: -1, step: 1 },
    capability: 'dry',
    disabledBy: (v) =>
      Number(v.dry_multiplier) === 0 ? 'Set DRY Multiplier > 0' : null,
  },
  ignore_eos: {
    key: 'ignore_eos',
    title: 'Ignore EOS',
    description: 'Continue past the end-of-sequence token.',
    value: false,
    controllerType: 'checkbox',
    capability: 'ignore_eos',
  },
}

/**
 * Sampler keys exposed as per-model defaults in the model edit dialog. Persist
 * to the model (model.yml → router preset for llamacpp) and act as defaults the
 * local API server uses; per-assistant and per-request values override them.
 * `repeat_last_n` is intentionally omitted — it has no paramsSettings entry.
 */
export const SAMPLER_DEFAULT_KEYS = [
  'temperature',
  'top_p',
  'top_k',
  'min_p',
  'repeat_penalty',
  'presence_penalty',
  'frequency_penalty',
] as const

// The MLX server only forwards these to GenerateParameters (top_k/min_p/
// presence/frequency are silently dropped); see mlx-server Server.swift.
export const MLX_SAMPLER_KEYS = [
  'temperature',
  'top_p',
  'repeat_penalty',
] as const

/** Sampler keys a provider actually honors. */
export function samplerKeysForProvider(
  providerId: string
): readonly string[] {
  return providerId === 'mlx' ? MLX_SAMPLER_KEYS : SAMPLER_DEFAULT_KEYS
}

/**
 * Model settings seed sampler keys with '' (predefined.ts); `??` wouldn't catch
 * the empty string, so resolve ''/null/undefined to the param's default.
 */
export function resolveSamplerValue(
  stored: unknown,
  fallback: string | number | boolean
): string | number | boolean {
  return stored === undefined || stored === null || stored === ''
    ? fallback
    : (stored as string | number | boolean)
}

/**
 * Outbound strip list for non-llamacpp providers. Kept explicit to preserve
 * existing wire-level behavior. resolveProviderCaps owns the richer UI gating.
 */
export const LLAMACPP_ONLY_PARAM_KEYS: ReadonlySet<string> = new Set([
  'mirostat',
  'mirostat_tau',
  'mirostat_eta',
  'grammar',
  'json_schema',
  'typical_p',
  'top_n_sigma',
  'dynatemp_range',
  'dynatemp_exp',
  'xtc_probability',
  'xtc_threshold',
  'dry_multiplier',
  'dry_base',
  'dry_allowed_length',
  'dry_penalty_last_n',
  'ignore_eos',
  'min_p',
  'repeat_penalty',
])

export function evaluateDisabled(
  def: ParamDef,
  currentValues: Record<string, unknown>
): string | null {
  return def.disabledBy?.(currentValues) ?? null
}

/**
 * Coupled samplers that only make sense as a unit. Adding the group writes
 * `triggerValue` to the first member (the on/off knob) plus the defaults of
 * the rest. Removing the group deletes every member key.
 */
export interface ParamGroup {
  id: string
  title: string
  description: string
  members: string[]
  triggerKey: string
  triggerValue: string | number | boolean
  capability: SamplerCap
}

export const paramGroups: ParamGroup[] = [
  {
    id: 'mirostat',
    title: 'Mirostat',
    description:
      'Adaptive perplexity-targeting sampler. Overrides Top K / Top P / Min P.',
    members: ['mirostat', 'mirostat_tau', 'mirostat_eta'],
    triggerKey: 'mirostat',
    triggerValue: 1,
    capability: 'mirostat',
  },
  {
    id: 'dry',
    title: 'DRY',
    description: "Don't-Repeat-Yourself penalty for long repeated sequences.",
    members: [
      'dry_multiplier',
      'dry_base',
      'dry_allowed_length',
      'dry_penalty_last_n',
    ],
    triggerKey: 'dry_multiplier',
    triggerValue: 0.8,
    capability: 'dry',
  },
  {
    id: 'xtc',
    title: 'XTC',
    description:
      'Exclude-Top-Choices sampler — probabilistically removes high-prob tokens.',
    members: ['xtc_probability', 'xtc_threshold'],
    triggerKey: 'xtc_probability',
    triggerValue: 0.1,
    capability: 'xtc',
  },
  {
    id: 'dynatemp',
    title: 'Dynamic Temperature',
    description: 'Sample the effective temperature from a range around the base.',
    members: ['dynatemp_range', 'dynatemp_exp'],
    triggerKey: 'dynatemp_range',
    triggerValue: 0.5,
    capability: 'dynatemp',
  },
]

const GROUPED_KEYS = new Set(paramGroups.flatMap((g) => g.members))

/** True iff this param belongs to a coupled group (rendered as a unit). */
export function isGroupedParamKey(key: string): boolean {
  return GROUPED_KEYS.has(key)
}

export type ParamCategory =
  | 'common'
  | 'penalties'
  | 'output'
  | 'advanced'

export interface CategoryDef {
  id: ParamCategory
  title: string
  /** Standalone param keys in display order. */
  paramKeys: string[]
  /** Coupled groups shown as a single menu entry in this category. */
  groupIds: string[]
}

export const paramCategories: CategoryDef[] = [
  {
    id: 'common',
    title: 'Common',
    paramKeys: ['temperature', 'top_p', 'top_k', 'min_p', 'max_output_tokens'],
    groupIds: [],
  },
  {
    id: 'penalties',
    title: 'Penalties',
    paramKeys: ['frequency_penalty', 'presence_penalty', 'repeat_penalty'],
    groupIds: [],
  },
  {
    id: 'output',
    title: 'Output control',
    paramKeys: [
      'stream',
      'json_schema',
      'grammar',
      'auto_compact',
      'max_context_tokens',
      'ignore_eos',
    ],
    groupIds: [],
  },
  {
    id: 'advanced',
    title: 'Advanced samplers',
    paramKeys: ['typical_p', 'top_n_sigma'],
    groupIds: ['mirostat', 'dry', 'xtc', 'dynatemp'],
  },
]
