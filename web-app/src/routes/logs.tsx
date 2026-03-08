import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'

import { useEffect, useState, useRef } from 'react'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n/react-i18next-compat'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.appLogs as any)({
  component: LogsViewer,
})

// Define log entry type

function LogsViewer() {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logsContainerRef = useRef<HTMLDivElement>(null)
  const serviceHub = useServiceHub()

  useEffect(() => {
    let lastLogsLength = 0
    function updateLogs() {
      serviceHub
        .app()
        .readLogs()
        .then((logData) => {
          let needScroll = false
          const filteredLogs = logData.filter(Boolean) as LogEntry[]
          if (filteredLogs.length > lastLogsLength) needScroll = true

          lastLogsLength = filteredLogs.length
          setLogs(filteredLogs)

          // Scroll to bottom after initial logs are loaded
          if (needScroll) setTimeout(() => scrollToBottom(), 100)
        })
    }
    updateLogs()

    // repeat action each 3s
    const intervalId = setInterval(() => updateLogs(), 3000)

    return () => {
      clearInterval(intervalId)
    }
  }, [serviceHub])

  // Function to scroll to the bottom of the logs container
  const scrollToBottom = () => {
    if (logsContainerRef.current) {
      const { scrollHeight, clientHeight } = logsContainerRef.current
      logsContainerRef.current.scrollTop = scrollHeight - clientHeight
    }
  }

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
      second: '2-digit',
    })
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-1 overflow-auto" ref={logsContainerRef}>
        <div className="font-mono p-2">
          {logs.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              {t('logs:noLogs')}
            </div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className="mb-1 flex">
                <span className="text-muted-foreground mr-2">
                  [{formatTimestamp(log.timestamp)}]
                </span>
                <span
                  className={`mr-2 font-semibold ${getLogLevelColor(log.level)}`}
                >
                  {log.level.toUpperCase()}
                </span>
                <span>{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
