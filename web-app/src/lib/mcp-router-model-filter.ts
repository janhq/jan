import { isLocalProvider } from '@/lib/utils'

/**
 * Models that are a poor fit for cheap structured routing (short generateObject calls).
 * Heuristic only — no API to “ask” providers for tier yet.
 */
const ROUTER_MODEL_DENY = new RegExp(
  [
    'opus',
    'claude-opus',
    'claude-3-opus',
    '\\bo1\\b',
    'o1-preview',
    '\\bo3\\b',
    'gpt-4-turbo',
    '^gpt-4$',
    'gpt-5(?!.*\\bmini\\b)',
  ].join('|'),
  'i'
)

/** Names/sizes that usually indicate small / routing-friendly models. */
const ROUTER_MODEL_ALLOW = new RegExp(
  [
    '\\bmini\\b',
    '\\bnano\\b',
    'flash',
    'haiku',
    '\\b8b\\b',
    '\\b7b\\b',
    '\\b3b\\b',
    '\\b2b\\b',
    '\\b1b\\b',
    '\\b1\\.6b\\b',
    '\\bsmall\\b',
    '\\btiny\\b',
    'phi[-_]?3',
    'gemma[-_]2b',
    'gpt-3\\.5',
    'gpt-4o-mini',
    'deepseek',
    '\\brouting\\b',
  ].join('|'),
  'i'
)

/** True if this model is likely cheap enough to use for MCP server routing only. */
export function isLikelyLightweightRouterModel(model: Model): boolean {
  const hay = `${model.id}\n${model.displayName ?? ''}`.toLowerCase()
  if (ROUTER_MODEL_DENY.test(hay)) return false
  if (ROUTER_MODEL_ALLOW.test(hay)) return true

  if (/\b(q4|q5|q6|q8)[-_]?([0-9]+)?k?_[a-z0-9+]*\b/i.test(hay)) {
    if (/\b(1|2|3|7|8)b\b/i.test(hay)) return true
  }
  return false
}

/** Shown in the router picker: lightweight heuristic + local or API-keyed remote. */
export function isRouterModelSelectable(
  provider: ModelProvider,
  model: Model
): boolean {
  if (!isLikelyLightweightRouterModel(model)) return false
  if (isLocalProvider(provider.provider)) return true
  return !!provider.api_key?.length
}
