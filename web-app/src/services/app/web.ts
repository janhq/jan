/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Web App Service - Web implementation
 */

import type { AppService, LogEntry } from './types'

export class WebAppService implements AppService {
  async factoryReset(): Promise<void> {
    console.log('Factory reset in web mode - clearing localStorage')
    window.localStorage.clear()
    window.location.reload()
  }

  async readLogs(): Promise<LogEntry[]> {
    console.log('Logs not available in web mode')
    return []
  }

  parseLogLine(line: string): LogEntry {
    // Simple fallback implementation for web mode
    return {
      timestamp: Date.now(),
      level: 'info' as 'info' | 'warn' | 'error' | 'debug',
      target: 'web',
      message: line ?? '',
    }
  }

  async getJanDataFolder(): Promise<string | undefined> {
    console.log('Data folder path not available in web mode')
    return undefined
  }

  async relocateJanDataFolder(_path: string): Promise<void> {
    console.log('Data folder relocation not available in web mode')
  }

  async getServerStatus(): Promise<boolean> {
    console.log('Server status not available in web mode')
    return false
  }

  async readYaml<T = unknown>(_path: string): Promise<T> {
    console.log('YAML reading not available in web mode')
    throw new Error('readYaml not implemented in web app service')
  }
}
