import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import {
  IconSearch,
  IconCopy,
  IconDownload,
  IconRefresh,
  IconLoader2,
  IconFileText,
} from '@tabler/icons-react'

interface SandboxLogsDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

export function SandboxLogsDialog({
  isOpen,
  onOpenChange,
}: SandboxLogsDialogProps) {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<string[]>([])
  const [filteredLogs, setFilteredLogs] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)

  const fetchLogs = useCallback(async () => {
    setIsLoading(true)
    try {
      const logLines = await invoke<string[]>('sandbox_get_logs', { lines: 200 })
      setLogs(logLines)
      setFilteredLogs(logLines)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      toast.error(`Failed to load logs: ${errorMsg}`)
      setLogs([])
      setFilteredLogs([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleRestart = useCallback(async () => {
    setIsRestarting(true)
    try {
      await invoke('sandbox_restart')
      toast.success(t('settings:remoteAccess.restarting'))
      onOpenChange(false)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      toast.error(`Failed to restart: ${errorMsg}`)
    } finally {
      setIsRestarting(false)
    }
  }, [onOpenChange, t])

  const handleCopy = useCallback(() => {
    const text = filteredLogs.join('\n')
    navigator.clipboard.writeText(text)
    toast.success(t('settings:remoteAccess.copiedToClipboard'))
  }, [filteredLogs, t])

  const handleDownload = useCallback(() => {
    const text = filteredLogs.join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `openclaw-logs-${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [filteredLogs])

  // Filter logs when search query changes
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredLogs(logs)
      return
    }
    const query = searchQuery.toLowerCase()
    const filtered = logs.filter((log) => log.toLowerCase().includes(query))
    setFilteredLogs(filtered)
  }, [searchQuery, logs])

  // Scroll to bottom when logs change
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [filteredLogs])

  // Subscribe to live log events
  useEffect(() => {
    if (!isOpen) return

    const unlisten = listen<string>('openclaw-log-line', (event) => {
      const line = event.payload
      setLogs((prev) => {
        const updated = [...prev, line]
        // Keep only last 500 lines
        return updated.slice(-500)
      })
    })

    return () => {
      unlisten.then((f) => f())
    }
  }, [isOpen])

  // Fetch logs when dialog opens
  useEffect(() => {
    if (isOpen) {
      fetchLogs()
    }
  }, [isOpen, fetchLogs])

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{t('settings:remoteAccess.logViewer')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 h-[500px]">
          {/* Toolbar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchLogs}
              disabled={isLoading}
            >
              {isLoading ? (
                <IconLoader2 className="h-4 w-4 animate-spin" />
              ) : (
                <IconRefresh className="h-4 w-4" />
              )}
            </Button>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <IconCopy className="h-4 w-4 mr-1" />
              {t('settings:remoteAccess.copyLogs')}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <IconDownload className="h-4 w-4 mr-1" />
              {t('settings:remoteAccess.downloadLogs')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRestart}
              disabled={isRestarting}
            >
              {isRestarting ? (
                <IconLoader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <IconRefresh className="h-4 w-4 mr-1" />
              )}
              {t('settings:remoteAccess.restartSandbox')}
            </Button>
          </div>

          {/* Log content */}
          <div className="flex-1 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs">
            {filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <IconFileText className="h-8 w-8 mb-2" />
                <p>{t('settings:remoteAccess.noLogs')}</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {filteredLogs.map((log, index) => (
                  <div key={index} className="whitespace-pre-wrap break-all">
                    {log}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}