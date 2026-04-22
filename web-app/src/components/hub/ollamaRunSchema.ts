export type OllamaRunFieldKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'nullable-boolean'
  | 'textarea'
  | 'json'
  | 'string-list'
  | 'think'

export type OllamaRunFieldLayout = 'compact' | 'wide' | 'full'

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

export const OLLAMA_RUN_FIELD_UI = {
  model: {
    help: '选择本地已下载模型。本面板只负责运行，不负责管理本地模型文件。',
    layout: 'wide',
  },
  keep_alive: {
    help: '控制模型在内存中的保留时间。常见值包括 -1、0、30s、5m。',
    layout: 'compact',
  },
  num_ctx: {
    help: '控制上下文窗口大小。值越大，可处理的历史上下文越长，但更占显存或内存。',
    layout: 'compact',
  },
  num_predict: {
    help: '控制最大生成 token 数。值越大，单次生成长度上限越高。',
    layout: 'compact',
  },
  temperature: {
    help: '控制采样随机性。值越高越发散，值越低越稳定。',
    layout: 'compact',
  },
  top_k: {
    help: '只从概率最高的前 K 个 token 中采样。数值越小越保守。',
    layout: 'compact',
  },
  top_p: {
    help: '按累计概率截断采样候选。较低值通常会让输出更收敛。',
    layout: 'compact',
  },
  min_p: {
    help: '过滤低于最小概率阈值的 token，用于进一步收紧采样范围。',
    layout: 'compact',
  },
  stop: {
    help: '设置停止词。支持多行输入，每行一个 stop 项。',
    layout: 'wide',
  },
  suffix: {
    help: '在生成结果后追加后缀文本。通常用于特定模板输出场景。',
    layout: 'wide',
  },
  system: {
    help: '设置系统提示词，用于约束模型角色、语气和行为。',
    layout: 'wide',
  },
  template: {
    help: '设置请求模板。通常只在你明确需要覆盖默认模板时填写。',
    layout: 'wide',
  },
  context: {
    help: '传入已有上下文 token 数组。这里需要填写有效 JSON。',
    layout: 'full',
  },
  raw: {
    help: '启用后按更原始的方式处理提示词，通常用于自定义模板场景。',
    layout: 'compact',
  },
  format: {
    help: '设置结构化输出格式。可以填写 json 或完整 JSON Schema。',
    layout: 'full',
  },
  think: {
    help: '控制模型思考模式。可填写 true、false 或 low / medium / high。',
    layout: 'compact',
  },
  truncate: {
    help: '控制超出上下文窗口时是否截断输入。',
    layout: 'compact',
  },
  shift: {
    help: '控制上下文移位策略，用于长上下文持续运行场景。',
    layout: 'compact',
  },
  logprobs: {
    help: '返回采样候选的对数概率信息，便于调试和分析输出。',
    layout: 'compact',
  },
  top_logprobs: {
    help: '设置返回多少个 top logprobs 候选项。',
    layout: 'compact',
  },
  _debug_render_only: {
    help: '调试字段，仅用于渲染或模板调试场景。',
    layout: 'compact',
  },
  num_keep: {
    help: '保留前部 token 数量，常用于配合上下文裁剪策略。',
    layout: 'compact',
  },
  seed: {
    help: '设置随机种子。固定后更容易复现相同输出。',
    layout: 'compact',
  },
  typical_p: {
    help: '启用 typical sampling 阈值，用于控制更“典型”的采样分布。',
    layout: 'compact',
  },
  repeat_last_n: {
    help: '重复惩罚参考的最近 token 数量。',
    layout: 'compact',
  },
  repeat_penalty: {
    help: '控制重复惩罚强度。值越高，越不容易重复已有内容。',
    layout: 'compact',
  },
  presence_penalty: {
    help: '鼓励模型引入新主题或新词项，降低内容重复。',
    layout: 'compact',
  },
  frequency_penalty: {
    help: '根据 token 出现频次施加惩罚，减少高频重复表达。',
    layout: 'compact',
  },
  num_batch: {
    help: '控制批处理大小。可能影响吞吐和资源占用。',
    layout: 'compact',
  },
  num_gpu: {
    help: '控制使用多少 GPU 层或 GPU 资源。',
    layout: 'compact',
  },
  main_gpu: {
    help: '指定主 GPU 编号，适用于多 GPU 环境。',
    layout: 'compact',
  },
  use_mmap: {
    help: '控制是否使用内存映射加载模型。通常会影响启动和内存行为。',
    layout: 'compact',
  },
  num_thread: {
    help: '控制 CPU 线程数。可能影响推理速度和 CPU 占用。',
    layout: 'compact',
  },
} as const satisfies Record<
  OllamaRunField,
  {
    help: string
    layout: OllamaRunFieldLayout
  }
>

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
