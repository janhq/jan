/**
 * App Service Types
 */

export interface LogEntry {
  timestamp: string | number
  level: 'info' | 'warn' | 'error' | 'debug'
  target: string
  message: string
}

export interface AppService {
  factoryReset(): Promise<void>
  readLogs(): Promise<LogEntry[]>
  parseLogLine(line: string): LogEntry
  getJanDataFolder(): Promise<string | undefined>
  relocateJanDataFolder(path: string): Promise<void>
  getServerStatus(): Promise<boolean>
  readYaml<T = unknown>(path: string): Promise<T>
}
