import { ScrollArea, Progress, Badge, Button } from '@janhq/uikit'

import { useActiveModel } from '@/hooks/useActiveModel'

import useGetSystemResources from '@/hooks/useGetSystemResources'

import { toGigabytes } from '@/utils/converter'

const Column = ['Name', 'Model ID', 'Size', 'Version', 'Action']

export default function SystemMonitorScreen() {
  const { ram, cpu } = useGetSystemResources()
  const { activeModel, stateModel, stopModel } = useActiveModel()

  return (
    <div className="flex h-full w-full bg-background dark:bg-background/50">
      <ScrollArea className="h-full w-full">
        <div className="h-full p-8" data-test-id="testid-system-monitor">
          <div className="grid grid-cols-2 gap-8 lg:grid-cols-3">
            <div className="rounded-xl border border-border px-8 py-6">
              <div className="flex items-center justify-between">
                <h4 className="text-base font-bold uppercase">ram ({ram}%)</h4>
                <span className="text-muted-foreground">
                  23 GB of 50 GB used
                </span>
              </div>
              <div className="mt-2">
                <Progress className="mb-2 h-10 rounded-md" value={ram} />
              </div>
            </div>
            <div className="rounded-xl border border-border px-8 py-6">
              <div className="flex items-center justify-between">
                <h4 className="text-base font-bold uppercase">cpu ({cpu}%)</h4>
                <span className="text-muted-foreground">
                  23 GB of 50 GB used
                </span>
              </div>
              <div className="mt-2">
                <Progress className="mb-2 h-10 rounded-md" value={cpu} />
              </div>
            </div>
          </div>

          {activeModel && (
            <div className="mt-8 rounded-xl border border-border shadow-lg">
              <div className="px-6 py-5">
                <h4 className="text-base font-medium">Running Models</h4>
              </div>
              <div className="relative overflow-x-auto shadow-md sm:rounded-lg">
                <table className="w-full px-8">
                  <thead className="w-full border-b border-border bg-secondary">
                    <tr>
                      {Column.map((col, i) => {
                        return (
                          <th
                            key={i}
                            className="px-6 py-2 text-left font-normal last:text-center"
                          >
                            {col}
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-6 py-2">{activeModel.name}</td>
                      <td className="px-6 py-2">{activeModel.id}</td>
                      <td className="px-6 py-2">
                        <Badge themes="secondary">
                          {toGigabytes(activeModel.metadata.size)}
                        </Badge>
                      </td>
                      <td className="px-6 py-2">
                        <Badge themes="secondary">{activeModel.version}</Badge>
                      </td>
                      <td className="px-6 py-2 text-center">
                        <Button
                          block
                          themes={
                            stateModel.state === 'stop' ? 'danger' : 'primary'
                          }
                          className="w-16"
                          loading={stateModel.loading}
                          onClick={() => stopModel(activeModel.id)}
                        >
                          Stop
                        </Button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
