type Language = 'en-US' | 'zh-CN' | 'zh-TW' | 'cs-CZ' | 'fr-FR' | 'de-DE' | 'id-ID' | 'ja-JP' | 'pl-PL' | 'pt-BR' | 'ru-RU' | 'vi-VN'
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
