import type { JSONObject } from '@ai-sdk/provider'
import {
  isThinkingBudgetLevelKey,
  type ThinkingBudgetLevelKey,
} from './thinkingBudget'

type ReasoningChoice = 'auto' | 'on' | 'off' | undefined

// OpenAI's reasoning_effort is a discrete level (no token budget). Our shared
// thinking-budget levels map 1:1; 'unlimited' has no effort equivalent and is
// treated as "no explicit effort" (model default), matching the UI's Default.
const LEVEL_TO_OPENAI_EFFORT: Partial<Record<ThinkingBudgetLevelKey, string>> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
}

// The AI SDK adds budget_tokens on top of max_tokens, so these are safe caps
// regardless of the request's output limit (Anthropic minimum is 1024).
const ANTHROPIC_LEVEL_BUDGET_TOKENS: Record<
  Exclude<ThinkingBudgetLevelKey, 'unlimited'>,
  number
> = {
  low: 4096,
  medium: 8192,
  high: 16384,
  xhigh: 32768,
}
const DEFAULT_ANTHROPIC_BUDGET_TOKENS = 8192

function readReasoning(model: Model | null | undefined): ReasoningChoice {
  const v = model?.settings?.reasoning?.controller_props?.value
  return v === 'on' || v === 'off' || v === 'auto' ? v : undefined
}

function readBudgetLevel(
  model: Model | null | undefined
): ThinkingBudgetLevelKey | undefined {
  const v = model?.settings?.thinking_budget_tokens?.controller_props?.value
  return isThinkingBudgetLevelKey(v) ? v : undefined
}

/**
 * Translate Jan's shared reasoning settings (reasoning on/off/auto + thinking
 * budget level) into the per-request `providerOptions` the AI SDK expects for
 * cloud providers, using each provider's NATIVE options rather than a
 * context-derived token budget (which we can't know for cloud models):
 *
 * - Google Gemini: `thinkingConfig.thinkingBudget` -1 (dynamic, model-sized) /
 *   0 (off), plus `includeThoughts` to surface thought summaries.
 * - Anthropic: `thinking` adaptive (model-sized, no token guess) / disabled.
 * - OpenAI: `reasoningEffort` discrete level (no budget).
 *
 * Returns undefined when the provider has no mapping or the user left reasoning
 * at its provider default.
 */
export function buildReasoningProviderOptions(
  providerId: string,
  model: Model | null | undefined
): Record<string, JSONObject> | undefined {
  const reasoning = readReasoning(model)
  const level = readBudgetLevel(model)

  if (providerId === 'google' || providerId === 'gemini') {
    if (reasoning === 'off') {
      return { google: { thinkingConfig: { thinkingBudget: 0 } } }
    }
    if (reasoning === 'on' || level) {
      return {
        google: { thinkingConfig: { thinkingBudget: -1, includeThoughts: true } },
      }
    }
    return undefined
  }

  if (providerId === 'anthropic') {
    if (reasoning === 'off') {
      return { anthropic: { thinking: { type: 'disabled' } } }
    }
    if (reasoning === 'on' || level) {
      const id = (model?.id ?? '').toLowerCase()
      // Adaptive thinking exists on Claude 4.6+ only; pre-4.6 models reject it
      // with a 400 and require enabled + budget_tokens. `display` shipped with
      // 4.7, so it is omitted on the 4.6 family. Unknown ids get the
      // current-generation default (adaptive + summarized).
      const isPre46 = /(opus|sonnet|haiku)-([0-3]|4-[0-5])\b/.test(id)
      if (isPre46) {
        const budgetTokens =
          level && level !== 'unlimited'
            ? ANTHROPIC_LEVEL_BUDGET_TOKENS[level]
            : DEFAULT_ANTHROPIC_BUDGET_TOKENS
        return { anthropic: { thinking: { type: 'enabled', budgetTokens } } }
      }
      const supportsDisplay = !/(opus|sonnet)-4-6\b/.test(id)
      return {
        anthropic: {
          thinking: supportsDisplay
            ? { type: 'adaptive', display: 'summarized' }
            : { type: 'adaptive' },
        },
      }
    }
    return undefined
  }

  if (providerId === 'openai') {
    // Reasoning models always reason, so 'off' has no universal equivalent;
    // only a concrete effort level maps ('unlimited' = model default).
    // reasoningSummary surfaces the (otherwise hidden) reasoning as summary
    // parts — it requires the Responses API, which model-factory selects when
    // an effort level is set.
    const effort = level ? LEVEL_TO_OPENAI_EFFORT[level] : undefined
    return effort
      ? { openai: { reasoningEffort: effort, reasoningSummary: 'auto' } }
      : undefined
  }

  return undefined
}
