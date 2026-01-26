type Language = 'en' | 'fr' | 'id' | 'vn' | 'pl' | 'zh-CN' | 'zh-TW' | 'de-DE' | 'cs' | 'it' | 'pt-BR' | 'ja' | 'ru'
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
