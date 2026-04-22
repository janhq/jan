/**
 * Heuristic capability detection based on model ID.
 *
 * For OpenAI-compatible and Ollama providers there is no standard API to
 * query what a model supports, so we infer from the model name.  These rules
 * are best-effort — the user can always override them in the Edit Model dialog.
 */

const REASONING_KEYWORDS = [
  'deepseek-r1',
  'deepseek-r2',
  'deepseek-reasoner',
  'qwq',
  'qvq',
  '-thinking',
  ':thinking',
  '-reasoning',  // sonar-reasoning, mistral-small-reasoning, etc.
  ':reasoning',
  'exaone-deep',
  'lfm-thinking',
]

// o1 / o3 family: match "o1" or "o3" at a word boundary followed by end, hyphen, or colon
// Avoids false positives like "tool", "model", "proto1".
const O_SERIES_RE = /\bo[13](-|:|$)/

const WEB_SEARCH_KEYWORDS = [
  'sonar',       // Perplexity sonar family
  '-online',
  ':online',
  'web-search',
  'websearch',
]

const EMBEDDINGS_KEYWORDS = [
  'embed',       // nomic-embed-text, mxbai-embed, text-embedding-*
  'bge-',        // BAAI/bge-*
  '-e5-',        // intfloat/e5-*
  'mxbai',
  'nomic',
  'gte-',        // Alibaba/gte-*
]

export type DetectedCapabilities = {
  reasoning: boolean
  web_search: boolean
  embeddings: boolean
}

export function detectModelCapabilities(modelId: string): DetectedCapabilities {
  const id = modelId.toLowerCase()

  const reasoning =
    REASONING_KEYWORDS.some((kw) => id.includes(kw)) || O_SERIES_RE.test(id)

  const web_search = WEB_SEARCH_KEYWORDS.some((kw) => id.includes(kw))

  const embeddings = EMBEDDINGS_KEYWORDS.some((kw) => id.includes(kw))

  return { reasoning, web_search, embeddings }
}

/** Returns true if any capability was inferred from the model name. */
export function hasDetectedCapabilities(detected: DetectedCapabilities): boolean {
  return detected.reasoning || detected.web_search || detected.embeddings
}
