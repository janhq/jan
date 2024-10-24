// The PORT to use for the Nitro subprocess
export const CORTEX_DEFAULT_PORT = 39291

// The HOST address to use for the Nitro subprocess
export const LOCAL_HOST = '127.0.0.1'

export const SUPPORTED_MODEL_FORMAT = '.gguf'

export const DEFAULT_CHAT_COMPLETION_URL = `http://${LOCAL_HOST}:${CORTEX_DEFAULT_PORT}/v1/chat/completions` // default nitro url
