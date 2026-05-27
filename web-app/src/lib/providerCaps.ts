import {
  paramsSettings,
  type ParamDef,
  type SamplerCap,
} from '@/lib/predefinedParams'

/**
 * Per-provider sampler capabilities. Built-in providers ship with locked
 * base_url (see web-app/src/constants/providers.ts), so the provider ID is
 * a reliable proxy for the underlying engine. User-added "custom" providers
 * point at arbitrary OpenAI-compatible endpoints — we can't know what
 * samplers they accept, so they fall through to a permissive set.
 */

export type CapabilitySupport = 'supported' | 'maybe'

export interface ProviderCaps {
  /** Forwarded as-is; UI control rendered without warning. */
  supported: ReadonlySet<SamplerCap>
  /** Forwarded; UI control marked with "may be ignored by this endpoint". */
  maybe: ReadonlySet<SamplerCap>
}

const CORE_ONLY = new Set<SamplerCap>(['core', 'client_only'])

const set = (...c: SamplerCap[]) =>
  new Set<SamplerCap>([...CORE_ONLY, ...c])

const OPENAI_STRICT: ProviderCaps = {
  supported: set('penalties', 'json_schema'),
  maybe: new Set(),
}

const ANTHROPIC: ProviderCaps = {
  supported: set('top_k'),
  maybe: new Set(),
}

const GOOGLE: ProviderCaps = {
  supported: set('top_k', 'min_p', 'repetition', 'penalties'),
  maybe: new Set(),
}

const COHERE: ProviderCaps = {
  supported: set('top_k', 'penalties'),
  maybe: new Set(),
}

const MISTRAL: ProviderCaps = {
  supported: set('penalties'),
  maybe: new Set(),
}

const GROQ: ProviderCaps = {
  supported: set(),
  maybe: new Set(['penalties']),
}

const OPENROUTER: ProviderCaps = {
  supported: set('penalties', 'top_k', 'min_p', 'repetition'),
  maybe: new Set(['typical_p']),
}

const XAI: ProviderCaps = {
  supported: set(),
  maybe: new Set(['penalties']),
}

const HUGGINGFACE: ProviderCaps = {
  supported: set('penalties'),
  maybe: new Set([
    'top_k',
    'min_p',
    'repetition',
    'typical_p',
  ]),
}

const NVIDIA: ProviderCaps = {
  supported: set('penalties'),
  maybe: new Set(['top_k']),
}

const AZURE: ProviderCaps = {
  supported: set('penalties', 'json_schema'),
  maybe: new Set(),
}

const MINIMAX: ProviderCaps = {
  supported: set('penalties'),
  maybe: new Set(),
}

const LLAMACPP: ProviderCaps = {
  supported: set(
    'penalties',
    'top_k',
    'min_p',
    'repetition',
    'mirostat',
    'dry',
    'xtc',
    'dynatemp',
    'typical_p',
    'top_n_sigma',
    'grammar',
    'json_schema',
    'ignore_eos'
  ),
  maybe: new Set(),
}

const MLX: ProviderCaps = {
  supported: set('top_k', 'repetition'),
  maybe: new Set(),
}

/**
 * Custom user-added providers default to permissive — the user explicitly
 * pointed at an OpenAI-compatible endpoint of unknown shape, so showing all
 * common samplers (marked "may be ignored") is more useful than hiding them.
 */
const CUSTOM_PERMISSIVE: ProviderCaps = {
  supported: set(),
  maybe: new Set([
    'penalties',
    'top_k',
    'min_p',
    'repetition',
    'mirostat',
    'dry',
    'xtc',
    'dynatemp',
    'typical_p',
    'top_n_sigma',
    'grammar',
    'json_schema',
    'ignore_eos',
  ]),
}

const BUILTIN_CAPS: Record<string, ProviderCaps> = {
  openai: OPENAI_STRICT,
  azure: AZURE,
  anthropic: ANTHROPIC,
  gemini: GOOGLE,
  google: GOOGLE,
  cohere: COHERE,
  mistral: MISTRAL,
  groq: GROQ,
  openrouter: OPENROUTER,
  xai: XAI,
  huggingface: HUGGINGFACE,
  nvidia: NVIDIA,
  minimax: MINIMAX,
  llamacpp: LLAMACPP,
  mlx: MLX,
}

export function resolveProviderCaps(
  provider: Pick<ProviderObject, 'provider' | 'api_type'> | string
): ProviderCaps {
  if (typeof provider !== 'string' && provider.api_type === 'anthropic') {
    return ANTHROPIC
  }
  const id = typeof provider === 'string' ? provider : provider.provider
  return BUILTIN_CAPS[id] ?? CUSTOM_PERMISSIVE
}

/** Wire format the provider speaks. Defaults to 'openai' when unset. */
export function getProviderApiType(
  provider: Pick<ProviderObject, 'provider' | 'api_type'> | undefined | null
): ProviderApiType {
  if (!provider) return 'openai'
  if (provider.api_type) return provider.api_type
  return provider.provider === 'anthropic' ? 'anthropic' : 'openai'
}

const LOCAL_PROVIDER_IDS = new Set<string>(['llamacpp', 'mlx'])

/**
 * Predefined remote providers ship locked base_urls and expose only a fixed
 * sampling surface — exposing the in-app sampler UI for them invites silent
 * 400s. Local engines and user-added custom OpenAI-compatible providers keep
 * the sampler UI.
 */
export function isPredefinedRemoteProvider(
  provider: Pick<ProviderObject, 'provider'> | string | undefined
): boolean {
  if (!provider) return false
  const id = typeof provider === 'string' ? provider : provider.provider
  return id in BUILTIN_CAPS && !LOCAL_PROVIDER_IDS.has(id)
}

/**
 * Sampler keys that some model families reject outright even when the
 * provider's API surface accepts them. Indexed by sampler capability — the
 * value is a predicate against (providerId, modelId).
 *
 * Sources:
 * - OpenAI/Azure reasoning families (o1, o3, o4, gpt-5*) hard-reject
 *   temperature, top_p, frequency_penalty, presence_penalty.
 * - xAI grok-3-mini rejects temperature/top_p; grok-3 and grok-4 reject
 *   penalties.
 */
const REASONING_MODEL_RE = /^(o[1-9]|gpt-?[5-9])/i
const GROK_NO_TEMP_RE = /^grok-3-mini/i
const GROK_NO_PENALTY_RE = /^grok-[3-9]/i

/**
 * Sampler keys some model families reject even when the provider's API
 * accepts them generally. Operates on param key (not capability) because
 * reasoning models reject `temperature`/`top_p` but still accept
 * `max_output_tokens` and `stream` — all four share capability='core'.
 */
/**
 * Cross-param conflicts the provider rejects (vs single-param rejections).
 * Returns the set of keys to drop from `parameters` to satisfy the rule.
 * Currently:
 *   - Anthropic forbids sending `temperature` and `top_p` together. We keep
 *     `temperature` (the more commonly tuned of the two) and drop `top_p`.
 */
export function getMutualExclusionDrops(
  parameters: Record<string, unknown>,
  providerId: string,
  apiType: ProviderApiType = 'openai'
): Set<string> {
  const drops = new Set<string>()
  if (providerId === 'anthropic' || apiType === 'anthropic') {
    if ('temperature' in parameters && 'top_p' in parameters) {
      drops.add('top_p')
    }
  }
  return drops
}

export function isModelLevelRejected(
  paramKey: string,
  providerId: string,
  modelId: string
): boolean {
  if (providerId === 'openai' || providerId === 'azure') {
    if (REASONING_MODEL_RE.test(modelId)) {
      return (
        paramKey === 'temperature' ||
        paramKey === 'top_p' ||
        paramKey === 'frequency_penalty' ||
        paramKey === 'presence_penalty'
      )
    }
    return false
  }
  if (providerId === 'xai') {
    if (
      GROK_NO_TEMP_RE.test(modelId) &&
      (paramKey === 'temperature' || paramKey === 'top_p')
    )
      return true
    if (
      GROK_NO_PENALTY_RE.test(modelId) &&
      (paramKey === 'frequency_penalty' || paramKey === 'presence_penalty')
    )
      return true
    return false
  }
  return false
}

export interface ParamSupportEntry {
  def: ParamDef
  /** Providers (by ID) that fully support this param. */
  supportedBy: string[]
  /** Providers (by ID) that may silently ignore it. */
  maybeBy: string[]
}

/**
 * Union of params across the given providers. Each entry records which
 * providers support vs. may-ignore the param so the UI can render a tooltip.
 * A param is included iff at least one provider lists it as supported or maybe.
 */
export function paramsForProviders(
  providers: Array<Pick<ProviderObject, 'provider'>>
): ParamSupportEntry[] {
  const entries: ParamSupportEntry[] = []
  for (const def of Object.values(paramsSettings)) {
    if (def.capability === 'client_only') {
      entries.push({ def, supportedBy: providers.map((p) => p.provider), maybeBy: [] })
      continue
    }
    const supportedBy: string[] = []
    const maybeBy: string[] = []
    for (const p of providers) {
      const caps = resolveProviderCaps(p)
      if (caps.supported.has(def.capability)) supportedBy.push(p.provider)
      else if (caps.maybe.has(def.capability)) maybeBy.push(p.provider)
    }
    if (supportedBy.length + maybeBy.length === 0) continue
    entries.push({ def, supportedBy, maybeBy })
  }
  return entries
}
