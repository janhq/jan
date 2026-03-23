export const paramsSettings = {
  stream: {
    key: 'stream',
    value: true,
    title: 'Stream',
    description: `Enables real-time response streaming.`,
  },
  max_output_tokens: {
    key: 'max_output_tokens',
    value: 2048,
    title: 'Max Output Tokens',
    description: `Maximum number of tokens the model can generate in a single reply. Sent as max_tokens to OpenAI-compatible APIs.`,
  },
  ctx_len: {
    key: 'ctx_len',
    value: 8192,
    title: 'Max Context Tokens',
    description: `Total context window size (input + output). Older messages are automatically trimmed to fit within this limit.`,
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
