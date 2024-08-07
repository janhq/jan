import { EngineStatus, LlmEngine, LocalEngines } from '@janhq/core'
import {
  Button,
  ScrollArea,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@janhq/joi'

import useEngineInit from '@/hooks/useEngineInit'
import useEngineQuery from '@/hooks/useEngineQuery'

import LoadingIndicator from '@/screens/HubScreen2/components/LoadingIndicator'

const getStatusTitle = (status: string) => {
  const normalized = status.charAt(0).toUpperCase() + status.slice(1)
  return normalized.replaceAll('_', ' ')
}

const EngineSetting: React.FC = () => {
  const { isLoading, data } = useEngineQuery()

  const initializeEngine = useEngineInit()

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <LoadingIndicator />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div>Failed to get engine statuses..</div>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full w-full">
      <div className="p-4">
        <Table>
          <TableCaption className="text-xl font-bold">Engines</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Engine name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Install</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((engineStatus) => {
              return (
                <TableRow key={engineStatus.name}>
                  <TableCell className="font-medium">
                    {engineStatus.name}
                  </TableCell>
                  <TableCell>{engineStatus.description}</TableCell>
                  <TableCell className="text-center">
                    {engineStatus.version}
                  </TableCell>
                  <TableCell>{getStatusTitle(engineStatus.status)}</TableCell>
                  <TableCell>
                    {LocalEngines.some((e) => e === engineStatus.name) &&
                    [EngineStatus.Ready, EngineStatus.NotInitialized].includes(
                      engineStatus.status as EngineStatus
                    ) ? (
                      <Button
                        theme="primary"
                        onClick={() =>
                          initializeEngine.mutate(
                            engineStatus.name as LlmEngine
                          )
                        }
                      >
                        {engineStatus.status === EngineStatus.Ready
                          ? 'Reinstall'
                          : 'Install'}
                      </Button>
                    ) : (
                      <Button theme="ghost" disabled>
                        N/A
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </ScrollArea>
  )
}

export default EngineSetting
