export type OllamaRunFieldKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'nullable-boolean'
  | 'textarea'
  | 'json'
  | 'string-list'
  | 'think'

type OllamaRunFieldSection = 'common' | 'advanced-request' | 'advanced-option'
type OllamaRunFieldLocation = 'request' | 'options'

type OllamaRunFieldDefinition = {
  name: string
  kind: OllamaRunFieldKind
  section: OllamaRunFieldSection
  location: OllamaRunFieldLocation
}

export const OLLAMA_RUN_THINK_VALUES = [
  '',
  'true',
  'false',
  'high',
  'medium',
  'low',
] as const

export const OLLAMA_RUN_FIELD_DEFINITIONS = [
  { name: 'model', kind: 'text', section: 'common', location: 'request' },
  { name: 'keep_alive', kind: 'text', section: 'common', location: 'request' },
  { name: 'num_ctx', kind: 'number', section: 'common', location: 'options' },
  { name: 'num_predict', kind: 'number', section: 'common', location: 'options' },
  { name: 'temperature', kind: 'number', section: 'common', location: 'options' },
  { name: 'top_k', kind: 'number', section: 'common', location: 'options' },
  { name: 'top_p', kind: 'number', section: 'common', location: 'options' },
  { name: 'min_p', kind: 'number', section: 'common', location: 'options' },
  { name: 'stop', kind: 'string-list', section: 'common', location: 'options' },
  { name: 'suffix', kind: 'textarea', section: 'advanced-request', location: 'request' },
  { name: 'system', kind: 'textarea', section: 'advanced-request', location: 'request' },
  { name: 'template', kind: 'textarea', section: 'advanced-request', location: 'request' },
  { name: 'context', kind: 'json', section: 'advanced-request', location: 'request' },
  { name: 'raw', kind: 'boolean', section: 'advanced-request', location: 'request' },
  { name: 'format', kind: 'json', section: 'advanced-request', location: 'request' },
  { name: 'think', kind: 'think', section: 'advanced-request', location: 'request' },
  {
    name: 'truncate',
    kind: 'nullable-boolean',
    section: 'advanced-request',
    location: 'request',
  },
  {
    name: 'shift',
    kind: 'nullable-boolean',
    section: 'advanced-request',
    location: 'request',
  },
  {
    name: 'logprobs',
    kind: 'boolean',
    section: 'advanced-request',
    location: 'request',
  },
  {
    name: 'top_logprobs',
    kind: 'number',
    section: 'advanced-request',
    location: 'request',
  },
  {
    name: '_debug_render_only',
    kind: 'boolean',
    section: 'advanced-request',
    location: 'request',
  },
  { name: 'num_keep', kind: 'number', section: 'advanced-option', location: 'options' },
  { name: 'seed', kind: 'number', section: 'advanced-option', location: 'options' },
  { name: 'typical_p', kind: 'number', section: 'advanced-option', location: 'options' },
  {
    name: 'repeat_last_n',
    kind: 'number',
    section: 'advanced-option',
    location: 'options',
  },
  {
    name: 'repeat_penalty',
    kind: 'number',
    section: 'advanced-option',
    location: 'options',
  },
  {
    name: 'presence_penalty',
    kind: 'number',
    section: 'advanced-option',
    location: 'options',
  },
  {
    name: 'frequency_penalty',
    kind: 'number',
    section: 'advanced-option',
    location: 'options',
  },
  { name: 'num_batch', kind: 'number', section: 'advanced-option', location: 'options' },
  { name: 'num_gpu', kind: 'number', section: 'advanced-option', location: 'options' },
  { name: 'main_gpu', kind: 'number', section: 'advanced-option', location: 'options' },
  {
    name: 'use_mmap',
    kind: 'nullable-boolean',
    section: 'advanced-option',
    location: 'options',
  },
  { name: 'num_thread', kind: 'number', section: 'advanced-option', location: 'options' },
] as const satisfies readonly OllamaRunFieldDefinition[]

type OllamaRunFieldDefinitionEntry = (typeof OLLAMA_RUN_FIELD_DEFINITIONS)[number]
type OllamaRunField = OllamaRunFieldDefinitionEntry['name']

export type OllamaRunFormState = Partial<Record<OllamaRunField, unknown>>

export const OLLAMA_RUN_FIELD_KIND_MAP = Object.fromEntries(
  OLLAMA_RUN_FIELD_DEFINITIONS.map((field) => [field.name, field.kind])
) as Record<OllamaRunField, OllamaRunFieldKind>

const getFieldNames = (section: OllamaRunFieldSection) =>
  OLLAMA_RUN_FIELD_DEFINITIONS.filter((field) => field.section === section).map(
    (field) => field.name
  )

export const OLLAMA_RUN_COMMON_FIELDS = getFieldNames('common')
export const OLLAMA_RUN_ADVANCED_REQUEST_FIELDS = getFieldNames('advanced-request')
export const OLLAMA_RUN_ADVANCED_OPTION_FIELDS = getFieldNames('advanced-option')

export const OLLAMA_RUN_REQUEST_FIELDS = OLLAMA_RUN_FIELD_DEFINITIONS.filter(
  (field) => field.location === 'request'
).map((field) => field.name)

export const OLLAMA_RUN_OPTION_FIELDS = OLLAMA_RUN_FIELD_DEFINITIONS.filter(
  (field) => field.location === 'options'
).map((field) => field.name)

export const OLLAMA_RUN_FIELD_GROUPS = {
  request: OLLAMA_RUN_REQUEST_FIELDS,
  options: OLLAMA_RUN_OPTION_FIELDS,
} as const

const isFiniteNumber = (value: number) => Number.isFinite(value)

const normalizeNumberValue = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return isFiniteNumber(value) ? value : undefined
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return undefined

    const parsed = Number(trimmed)
    return isFiniteNumber(parsed) ? parsed : undefined
  }

  return undefined
}

const normalizeBooleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

const normalizeJsonFieldValue = (
  field: 'context' | 'format',
  value: unknown
): unknown => {
  if (typeof value !== 'string') return value

  const trimmed = value.trim()
  if (trimmed === '') return undefined

  try {
    return JSON.parse(trimmed)
  } catch {
    throw new Error(`${field} 需要有效的 JSON`)
  }
}

const normalizeFieldValue = (field: OllamaRunField, value: unknown): unknown => {
  const kind = OLLAMA_RUN_FIELD_KIND_MAP[field]

  if (kind === 'number') return normalizeNumberValue(value)

  if (kind === 'boolean' || kind === 'nullable-boolean') {
    return normalizeBooleanValue(value)
  }

  if (kind === 'think') {
    const booleanValue = normalizeBooleanValue(value)
    if (booleanValue !== undefined) return booleanValue

    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed === '' ? undefined : trimmed
    }

    return value
  }

  if (kind === 'json') {
    return normalizeJsonFieldValue(field as 'context' | 'format', value)
  }

  if (kind === 'string-list') {
    if (Array.isArray(value)) {
      const normalized = value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
      return normalized.length > 0 ? normalized : undefined
    }

    if (typeof value === 'string') {
      const normalized = value
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
      return normalized.length > 0 ? normalized : undefined
    }
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return undefined

    if (field === 'model' || field === 'keep_alive') {
      return trimmed
    }
  }

  if (value == null) return undefined
  return value
}

export const buildOllamaRunPayload = (
  form: OllamaRunFormState
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {}
  const options: Record<string, unknown> = {}

  for (const field of OLLAMA_RUN_REQUEST_FIELDS) {
    const normalizedValue = normalizeFieldValue(field, form[field])
    if (normalizedValue === undefined) continue
    payload[field] = normalizedValue
  }

  for (const field of OLLAMA_RUN_OPTION_FIELDS) {
    const normalizedValue = normalizeFieldValue(field, form[field])
    if (normalizedValue === undefined) continue
    options[field] = normalizedValue
  }

  if (Object.keys(options).length > 0) {
    payload.options = options
  }

  return payload
}
