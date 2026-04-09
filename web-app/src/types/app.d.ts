type Language =
  | 'en'
  | 'es'
  | 'fr'
  | 'id'
  | 'pl'
  | 'vn'
  | 'zh-CN'
  | 'zh-TW'
  | 'de-DE'
  | 'cs'
  | 'pt-BR'
  | 'ko'
  | 'ja'
  | 'ru'
  | 'ca'
  | 'tr'
interface LogEntry {
  timestamp: string | number
  level: 'info' | 'warn' | 'error' | 'debug'
  target: string
  message: string
}

type ErrorObject = {
  code?: string
  message: string
  details?: string
}
