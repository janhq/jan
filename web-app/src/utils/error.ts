export const OUT_OF_CONTEXT_SIZE =
  'the request exceeds the available context size.'

// Matches OUT_OF_CONTEXT_SIZE and llama-server's verbose variant
// ("request (N tokens) exceeds the available context size (M tokens)…").
export function isContextOverflowMessage(message: string): boolean {
  return /exceeds the available context size/i.test(message)
}
