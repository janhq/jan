import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useServiceHub } from '@/hooks/useServiceHub'
import type { LogEntry } from '@/services/app/types'
import { useTranslation } from '@/i18n/react-i18next-compat'

const MCP_LOG_TARGET_PREFIX = 'app_lib::core::mcp'
const LOG_EVENT_NAME = 'log://log'

// Note: per-server filtering relies on a substring match of `serverName`
// against the log message body. Rust MCP code embeds server names directly
// in log messages (e.g. "Starting MCP server {name}"), but some shared
// lifecycle logs (port cleanup, full server_map dump) do not — those will
// only be visible when no server filter is applied.
interface Props {
  serverName?: string
}

export function MCPLogViewer({ serverName }: Props) {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logsContainerRef = useRef<HTMLDivElement>(null)
  const serviceHub = useServiceHub()

  const scrollToBottom = useCallback(() => {
    const el = logsContainerRef.current
    if (el) {
      el.scrollTop = el.scrollHeight - el.clientHeight
    }
  }, [])

  const matchesMcp = useCallback((log: LogEntry | undefined): log is LogEntry => {
    return !!log?.target && log.target.startsWith(MCP_LOG_TARGET_PREFIX)
  }, [])

  useEffect(() => {
    serviceHub.app().readLogs().then((logData) => {
      const filtered = logData.filter(matchesMcp)
      setLogs(filtered)
      setTimeout(() => {
        scrollToBottom()
      }, 100)
    })

    let unsubscribe = () => {}
    serviceHub
      .events()
      .listen(LOG_EVENT_NAME, (event) => {
        const { message } = event.payload as { message: string }
        const log: LogEntry | undefined = serviceHub.app().parseLogLine(message)
        if (matchesMcp(log)) {
          setLogs((prevLogs) => {
            const newLogs = [...prevLogs, log]
            setTimeout(() => {
              scrollToBottom()
            }, 0)
            return newLogs
          })
        }
      })
      .then((unsub) => {
        unsubscribe = unsub
      })

    return () => {
      unsubscribe()
    }
  }, [serviceHub, scrollToBottom, matchesMcp])

  const visibleLogs = useMemo(() => {
    if (!serverName) return logs
    const needle = serverName.toLowerCase()
    return logs.filter((log) => log.message?.toLowerCase().includes(needle))
  }, [logs, serverName])

  const getLogLevelColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'text-red-500'
      case 'warn':
        return 'text-yellow-500'
      case 'info':
        return 'text-blue-500'
      case 'debug':
        return 'text-gray-500'
      default:
        return 'text-gray-500'
    }
  }

  const formatTimestamp = (timestamp: string | number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  return (
    <div
      ref={logsContainerRef}
      className="border h-full rounded-md bg-background p-4 px-2 block overflow-y-auto overflow-hidden"
    >
      <div>
        <div className="font-mono text-xs">
          {visibleLogs.length === 0 ? (
            <div className="text-center text-muted-foreground py-4">
              {t('mcp-servers:logs.noLogs')}
            </div>
          ) : (
            visibleLogs.map((log, index) => (
              <div key={index} className="mb-1 flex">
                <span className="text-muted-foreground mr-2 shrink-0">
                  [{formatTimestamp(log.timestamp)}]
                </span>
                <span
                  className={`mr-2 font-semibold shrink-0 ${getLogLevelColor(
                    log.level
                  )}`}
                >
                  {log.level.toUpperCase()}
                </span>
                <span className="break-all">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
