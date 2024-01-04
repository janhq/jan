import { ScrollArea, Progress, Badge, Button } from '@janhq/uikit'

import { useAtomValue } from 'jotai'

import { useActiveModel } from '@/hooks/useActiveModel'

import { toGibibytes } from '@/utils/converter'

import {
  cpuUsageAtom,
  totalRamAtom,
  usedRamAtom,
} from '@/helpers/atoms/SystemBar.atom'

const Column = ['Name', 'Model ID', 'Size', 'Version', 'Action']

export default function SystemMonitorScreen() {
  const totalRam = useAtomValue(totalRamAtom)
  const usedRam = useAtomValue(usedRamAtom)
  const cpuUsage = useAtomValue(cpuUsageAtom)
  const { activeModel, stateModel, stopModel } = useActiveModel()

  return (
    <div className="flex h-full w-full bg-background dark:bg-background">
      <ScrollArea className="h-full w-full">
        <div className="h-full p-8" data-test-id="testid-system-monitor">
          <div className="grid grid-cols-2 gap-8 lg:grid-cols-3">
            <div className="rounded-xl border border-border p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-base font-bold uppercase">
                  ram ({Math.round((usedRam / totalRam) * 100)}%)
                </h4>
                <span className="text-xs text-muted-foreground">
                  {toGibibytes(usedRam)} of {toGibibytes(totalRam)} used
                </span>
              </div>
              <div className="mt-2">
                <Progress
                  className="mb-2 h-10 rounded-md"
                  value={Math.round((usedRam / totalRam) * 100)}
                />
              </div>
            </div>
            <div className="rounded-xl border border-border p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-base font-bold uppercase">
                  cpu ({cpuUsage}%)
                </h4>
                <span className="text-xs text-muted-foreground">
                  {cpuUsage}% of 100%
                </span>
              </div>
              <div className="mt-2">
                <Progress className="mb-2 h-10 rounded-md" value={cpuUsage} />
              </div>
            </div>
          </div>

          {activeModel && (
            <div className="mt-8 overflow-hidden rounded-xl border border-border shadow-sm">
              <div className="px-6 py-5">
                <h4 className="text-base font-medium">
                  Actively Running Models
                </h4>
              </div>
              <div className="relative overflow-x-auto shadow-md">
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
                      <td className="px-6 py-2 font-bold">
                        {activeModel.name}
                      </td>
                      <td className="px-6 py-2 font-bold">{activeModel.id}</td>
                      <td className="px-6 py-2">
                        <Badge themes="secondary">
                          {toGibibytes(activeModel.metadata.size)}
                        </Badge>
                      </td>
                      <td className="px-6 py-2">
                        <Badge themes="secondary">v{activeModel.version}</Badge>
                      </td>
                      <td className="px-6 py-2 text-center">
                        <Button
                          block
                          themes={
                            stateModel.state === 'stop' ? 'danger' : 'primary'
                          }
                          className="w-16"
                          loading={stateModel.loading}
                          onClick={() => stopModel()}
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
