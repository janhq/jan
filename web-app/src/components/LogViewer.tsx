import { useEffect, useState, useRef, useCallback } from 'react'
import { useServiceHub } from '@/hooks/useServiceHub'
import type { LogEntry } from '@/services/app/types'
import { useTranslation } from '@/i18n/react-i18next-compat'

interface LogViewerProps {
  className?: string
  maxHeight?: string
  filterTarget?: string
  isVisible?: boolean
}

const SERVER_LOG_TARGET = 'app_lib::core::server::proxy'
const LOG_EVENT_NAME = 'log://log'

export function LogViewer({
  isVisible,
}: LogViewerProps) {
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

  // Scroll when visibility changes OR when logs change (and isVisible is true)
  useEffect(() => {
    if (isVisible && logs.length > 0) {
      // Use requestAnimationFrame to ensure DOM is fully rendered
      let rafId1: number
      let rafId2: number

      rafId1 = requestAnimationFrame(() => {
        scrollToBottom()
        // Try again after a frame to handle any animations
        rafId2 = requestAnimationFrame(scrollToBottom)
      })

      return () => {
        cancelAnimationFrame(rafId1)
        cancelAnimationFrame(rafId2)
      }
    }
  }, [isVisible, logs.length, scrollToBottom])

  // Initial scroll to bottom when logs are loaded
  useEffect(() => {
      serviceHub.app().readLogs().then((logData) => {
        const logs = logData
          .filter((log) => log?.target === SERVER_LOG_TARGET)
          .filter(Boolean) as LogEntry[]
        setLogs(logs)

        // Scroll to bottom after initial logs are loaded
        setTimeout(() => {
          scrollToBottom()
        }, 100)
      })
      let unsubscribe = () => {}
      serviceHub.events().listen(LOG_EVENT_NAME, (event) => {
        const { message } = event.payload as { message: string }
        const log: LogEntry | undefined = serviceHub.app().parseLogLine(message)
        if (log?.target === SERVER_LOG_TARGET) {
          setLogs((prevLogs) => {
            const newLogs = [...prevLogs, log]
            // Schedule scroll to bottom after state update
            setTimeout(() => {
              scrollToBottom()
            }, 0)
            return newLogs
          })
        }
      }).then((unsub) => {
        unsubscribe = unsub
      })
      return () => {
        unsubscribe()
      }
    }, [serviceHub, scrollToBottom])

    // Function to get appropriate color for log level
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

    // Format timestamp to be more readable
    const formatTimestamp = (timestamp: string | number) => {
      const date = new Date(timestamp)
      return date.toLocaleTimeString('en-US', {
        hour12: false,
        timeZone: 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    }

  return (
    <div ref={logsContainerRef} className="border h-full rounded-md bg-background p-4 px-2 block overflow-y-auto overflow-hidden">
      <div
      >
        <div className="font-mono text-xs">
          {logs.length === 0 ? (
            <div className="text-center text-muted-foreground py-4">
              {t('logs:noLogs')}
            </div>
          ) : (
            logs.map((log, index) => (
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