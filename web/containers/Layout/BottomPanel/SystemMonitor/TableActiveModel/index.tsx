import { useCallback } from 'react'

import { Model } from '@janhq/core'
import { Button, Badge } from '@janhq/joi'

import { useAtomValue } from 'jotai'

import useModelStop from '@/hooks/useModelStop'

import {
  activeModelsAtom,
  downloadedModelsAtom,
} from '@/helpers/atoms/Model.atom'

const Column = ['Name', 'Engine', '']

const TableActiveModel: React.FC = () => {
  const stopModelMutation = useModelStop()
  const activeModels = useAtomValue(activeModelsAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)

  const models: Model[] = []
  activeModels.forEach((m) => {
    const model = downloadedModels.find((dm) => dm.model === m.model)
    if (model) {
      models.push(model)
    }
  })

  const onStopModelClick = useCallback(
    (modelId: string) => {
      stopModelMutation.mutate(modelId)
    },
    [stopModelMutation]
  )

  return (
    <div className="m-4 mr-0 w-1/2">
      <div className="overflow-hidden rounded-lg border border-[hsla(var(--app-border))]">
        <table className="w-full px-8">
          <thead className="w-full border-b border-[hsla(var(--app-border))] first:border-none">
            <tr>
              {Column.map((col, i) => (
                <th
                  key={i}
                  className="px-4 py-2 text-left font-normal last:text-center"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          {models.map((model) => (
            <tbody key={model.model}>
              <tr>
                <td
                  className="max-w-[200px] px-4 py-2 font-bold"
                  title={model.name}
                >
                  <p className="line-clamp-2">{model.model}</p>
                </td>
                <td className="px-4 py-2">
                  <Badge theme="secondary">
                    {!model.engine ? '-' : `${model.engine}`}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-center">
                  <Button
                    theme="destructive"
                    onClick={() => onStopModelClick(model.model)}
                  >
                    Stop
                  </Button>
                </td>
              </tr>
            </tbody>
          ))}
        </table>
      </div>
    </div>
  )
}

export default TableActiveModel
