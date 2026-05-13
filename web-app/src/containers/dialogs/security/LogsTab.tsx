import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { IconHistory, IconLoader2, IconRefresh, IconTrash } from '@tabler/icons-react'
import type { AccessLogEntry } from '@/hooks/useSecurityConfig'

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString()
  } catch {
    return dateStr
  }
}

export function LogsTab(props: {
  fetchLogs: () => Promise<void>
  isLoadingLogs: boolean
  isClearingLogs: boolean
  logs: AccessLogEntry[]
  onConfirmClear: () => void
}) {
  const { fetchLogs, isLoadingLogs, isClearingLogs, logs, onConfirmClear } = props

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-foreground">Recent Access Logs</h4>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={fetchLogs}
            disabled={isLoadingLogs}
          >
            <IconRefresh size={16} className={cn(isLoadingLogs && 'animate-spin')} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onConfirmClear}
            disabled={isClearingLogs || logs.length === 0}
            className="text-destructive hover:text-destructive"
          >
            <IconTrash size={16} className="mr-1" />
            Clear
          </Button>
        </div>
      </div>

      {isLoadingLogs ? (
        <div className="flex items-center justify-center py-8">
          <IconLoader2 className="animate-spin h-6 w-6 text-muted-foreground" />
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <IconHistory size={32} className="mx-auto mb-2 opacity-50" />
          <p>No access logs</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {logs.map((log, index) => (
            <div
              key={index}
              className={cn(
                'p-3 rounded-lg text-sm',
                log.success ? 'bg-secondary/30' : 'bg-destructive/10'
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'w-2 h-2 rounded-full',
                      log.success ? 'bg-green-500' : 'bg-red-500'
                    )}
                  />
                  <span className="font-medium text-foreground">{log.action}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                    {log.channel}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDate(log.timestamp)}
                </span>
              </div>
              <div className="text-muted-foreground text-xs space-x-3">
                <span>User: {log.user_id}</span>
                {log.ip_address && <span>IP: {log.ip_address}</span>}
                {log.device_id && <span>Device: {log.device_id}</span>}
              </div>
              {log.error && <p className="text-destructive text-xs mt-1">{log.error}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
