import { useState } from 'react'
import {
  IconLoader,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconTerminal2,
} from '@tabler/icons-react'

import { Button } from '@/components/ui/button'
import { Card, CardItem } from '@/containers/Card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useManagedProviderRuntime } from '@/hooks/useManagedProviderRuntime'
import type { ManagedProviderId } from '@/constants/managedProviders'
import { getProviderTitle } from '@/lib/utils'

type ManagedProviderPanelProps = {
  providerId: ManagedProviderId
  baseUrl?: string
  apiKey?: string
}

export function ManagedProviderPanel({
  providerId,
  baseUrl,
  apiKey,
}: ManagedProviderPanelProps) {
  const {
    config,
    status,
    loading,
    logs,
    refresh,
    spawnRuntime,
    stopRuntime,
    loadLogs,
  } = useManagedProviderRuntime(providerId, baseUrl, apiKey)
  const [spawnOpen, setSpawnOpen] = useState(false)
  const [spawnModel, setSpawnModel] = useState('')
  const [logsOpen, setLogsOpen] = useState(false)

  if (!config) return null

  const title = getProviderTitle(providerId)

  return (
    <>
      <Card
        header={
          <div className="flex items-center justify-between w-full mb-2">
            <span className="font-medium text-base font-studio text-foreground">
              Runtime
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <IconRefresh
                size={14}
                className={loading ? 'animate-spin text-muted-foreground' : ''}
              />
            </Button>
          </div>
        }
      >
        <CardItem
          title="Binary"
          description={`Detect ${config.binaryName} on PATH before starting a managed process.`}
          actions={
            <span className="text-sm text-foreground">
              {status.binary?.found ? 'Found' : 'Not detected'}
            </span>
          }
        />
        <CardItem
          title="Endpoint"
          description="Health check against the configured OpenAI-compatible base URL."
          actions={
            <span className="text-sm text-foreground">
              {status.endpoint?.reachable
                ? `Online (${status.endpoint.modelCount ?? 0} models)`
                : 'Offline'}
            </span>
          }
        />
        {status.process && (
          <CardItem
            title="Managed process"
            description={
              status.process.pid === 0
                ? 'Attached to an already-running daemon.'
                : 'Process started from Jan. Stop it here when you are done testing.'
            }
            actions={
              <span className="font-mono text-sm text-foreground">
                {status.process.pid === 0
                  ? 'External'
                  : `PID ${status.process.pid}`}
              </span>
            }
          />
        )}
        <CardItem
          title="Actions"
          description={
            config.spawnModelRequired
              ? `Start ${title} with a Hugging Face model id or local path.`
              : `Start or attach to the ${title} daemon, then refresh models below.`
          }
          actions={
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await loadLogs()
                  setLogsOpen(true)
                }}
              >
                <IconTerminal2 size={14} />
                Logs
              </Button>
              {status.process && status.process.pid > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void stopRuntime()}
                >
                  <IconPlayerStop size={14} />
                  Stop
                </Button>
              ) : status.endpoint?.reachable ? (
                <Button size="sm" variant="outline" disabled>
                  <IconPlayerPlay size={14} />
                  Running
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSpawnOpen(true)}
                  disabled={!status.binary?.found}
                >
                  <IconPlayerPlay size={14} />
                  Start
                </Button>
              )}
            </div>
          }
        />
      </Card>

      <Dialog open={spawnOpen} onOpenChange={setSpawnOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Start {title}</DialogTitle>
          </DialogHeader>
          <label className="block space-y-2 text-sm">
            <span className="text-foreground">
              {config.spawnModelRequired
                ? 'Model id or path'
                : 'Optional model id (daemon only)'}
            </span>
            <Input
              value={spawnModel}
              onChange={(event) => setSpawnModel(event.target.value)}
              placeholder={
                config.spawnModelRequired
                  ? 'meta-llama/Llama-3.2-3B-Instruct'
                  : 'Leave empty to run ollama serve'
              }
            />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSpawnOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={config.spawnModelRequired && !spawnModel.trim()}
              onClick={async () => {
                await spawnRuntime(spawnModel.trim())
                setSpawnOpen(false)
                setSpawnModel('')
              }}
            >
              {loading ? (
                <IconLoader size={14} className="animate-spin" />
              ) : null}
              Start
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className="max-h-[80vh] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{title} runtime logs</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-foreground/5 p-3 text-xs text-muted-foreground">
            {logs || 'No logs yet for this managed runtime.'}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  )
}
