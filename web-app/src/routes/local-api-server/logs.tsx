import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'

import { useEffect, useState } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.localApiServerlogs as any)({
  component: LogsViewer,
})

// Define log entry type
interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
}

// Generate dummy log data
const generateDummyLogs = (): LogEntry[] => {
  const logs: LogEntry[] = []
  const levels: ('info' | 'warn' | 'error' | 'debug')[] = [
    'info',
    'warn',
    'error',
    'debug',
  ]
  const messages = [
    'Server started on port 3000',
    'Received request: GET /api/v1/models',
    'Processing request...',
    'Request completed in 120ms',
    'Connection established with client',
    'Authentication successful for user',
    'Failed to connect to database',
    'API rate limit exceeded',
    'Memory usage: 256MB',
    'CPU usage: 45%',
    'Websocket connection closed',
    'Cache miss for key: model_list',
    'Updating configuration...',
    'Configuration updated successfully',
    'Initializing model...',
  ]

  // Generate 50 log entries
  const now = new Date()
  for (let i = 0; i < 50; i++) {
    const timestamp = new Date(now.getTime() - (50 - i) * 30000) // 30 seconds apart
    logs.push({
      timestamp: timestamp.toISOString(),
      level: levels[Math.floor(Math.random() * levels.length)],
      message: messages[Math.floor(Math.random() * messages.length)],
    })
  }

  return logs
}

function LogsViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([])

  useEffect(() => {
    // Load dummy logs when component mounts
    setLogs(generateDummyLogs())

    // Simulate new logs coming in every 5 seconds
    const interval = setInterval(() => {
      setLogs((currentLogs) => {
        const newLog: LogEntry = {
          timestamp: new Date().toISOString(),
          level: ['info', 'warn', 'error', 'debug'][
            Math.floor(Math.random() * 4)
          ] as 'info' | 'warn' | 'error' | 'debug',
          message: `New activity at ${new Date().toLocaleTimeString()}`,
        }
        return [...currentLogs, newLog]
      })
    }, 5000)

    return () => clearInterval(interval)
  }, [])

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
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString()
  }

  return (
    <div className="flex flex-col h-full bg-main-view">
      <div className="flex-1 overflow-auto">
        <div className="font-mono p-2">
          {logs.length === 0 ? (
            <div className="text-center text-main-view-fg/50 py-8">
              No logs available
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
