// The PORT to use for the Nitro subprocess
export const NITRO_DEFAULT_PORT = 3928

// The HOST address to use for the Nitro subprocess
export const LOCAL_HOST = '127.0.0.1'

export const SUPPORTED_MODEL_FORMAT = '.gguf'

// The URL for the Nitro subprocess
const NITRO_HTTP_SERVER_URL = `http://${LOCAL_HOST}:${NITRO_DEFAULT_PORT}`
// The URL for the Nitro subprocess to load a model
export const NITRO_HTTP_LOAD_MODEL_URL = `${NITRO_HTTP_SERVER_URL}/inferences/llamacpp/loadmodel`
// The URL for the Nitro subprocess to validate a model
export const NITRO_HTTP_VALIDATE_MODEL_URL = `${NITRO_HTTP_SERVER_URL}/inferences/llamacpp/modelstatus`

// The URL for the Nitro subprocess to kill itself
export const NITRO_HTTP_KILL_URL = `${NITRO_HTTP_SERVER_URL}/processmanager/destroy`

export const DEFAULT_CHAT_COMPLETION_URL = `http://${LOCAL_HOST}:${NITRO_DEFAULT_PORT}/inferences/llamacpp/chat_completion` // default nitro url
