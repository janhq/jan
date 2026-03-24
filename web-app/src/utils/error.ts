export const OUT_OF_CONTEXT_SIZE =
  'the request exceeds the available context size.'

const TOKEN_LIMIT_PATTERNS = [
  'maximum context length',
  'context_length_exceeded',
  'context length exceeded',
  'max_tokens is too large',
  'max_tokens too large',
  'too many tokens',
  'token limit',
  'prompt is too long',
  'request too large',
  'input too long',
  'maximum number of tokens',
  'reduce the length',
  'reduce your prompt',
  'input length exceeds',
  'exceeds the available context',
  'context size',
  'context length',
  'context limit',
]

export function isTokenLimitError(errorMessage: string | undefined): boolean {
  if (!errorMessage) return false
  if (errorMessage === OUT_OF_CONTEXT_SIZE) return true
  const lower = errorMessage.toLowerCase()
  return TOKEN_LIMIT_PATTERNS.some((pattern) => lower.includes(pattern))
}
