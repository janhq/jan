export const paramsSettings = {
  stream: {
    key: 'stream',
    value: true,
    title: 'Stream',
    description: `Enables real-time response streaming.`,
  },
  max_context_tokens: {
    key: 'max_context_tokens',
    value: 0,
    title: 'Max Context Tokens',
    description: `Total token budget (input + output) for the model. When set (> 0), older messages are automatically trimmed or compacted to stay within this limit. Set to 0 to disable (no trimming). Common values: 4096, 8192, 16384, 32768, 128000.`,
  },
  max_output_tokens: {
    key: 'max_output_tokens',
    value: 2048,
    title: 'Max Output Tokens',
    description: `Maximum number of tokens the model can generate in a single reply. Sent as max_tokens to OpenAI-compatible APIs.`,
  },
  auto_compact: {
    key: 'auto_compact',
    value: false,
    title: 'Auto Compact',
    description: `When enabled and context limit is reached, automatically summarize older messages instead of dropping them. Preserves conversation meaning while reducing token usage. Requires max_context_tokens to be set.`,
  },
  temperature: {
    key: 'temperature',
    value: 0.7,
    title: 'Temperature',
    description: `Controls response randomness. Higher values produce more creative, varied responses. `,
  },
  frequency_penalty: {
    key: 'frequency_penalty',
    value: 0.7,
    title: 'Frequency Penalty',
    description: `Reduces word repetition. Higher values encourage more varied language. Useful for creative writing and content generation.`,
  },
  presence_penalty: {
    key: 'presence_penalty',
    value: 0.7,
    title: 'Presence Penalty',
    description: `Encourages the model to explore new topics. Higher values help prevent the model from fixating on already-discussed subjects.`,
  },
  top_p: {
    key: 'top_p',
    value: 0.95,
    title: 'Top P',
    description: `Set probability threshold for more relevant outputs. Higher values allow more diverse word choices.`,
    controllerType: 'slider',
  },
  top_k: {
    key: 'top_k',
    value: 2,
    title: 'Top K',
    description:
      'Number of most relevant documents to retrieve. Higher values return more results.',
  },
}
