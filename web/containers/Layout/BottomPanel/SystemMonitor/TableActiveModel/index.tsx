import { Button, Badge } from '@janhq/joi'

import { useAtomValue } from 'jotai'

import useModels from '@/hooks/useModels'

import { toGibibytes } from '@/utils/converter'

import { activeModelsAtom } from '@/helpers/atoms/Model.atom'

const Column = ['Name', 'Size', '']

const TableActiveModel: React.FC = () => {
  const { stopModel } = useModels()
  const activeModels = useAtomValue(activeModelsAtom)

  return (
    <div className="m-4 mr-0 w-1/2">
      <div className="overflow-hidden rounded-lg border border-[hsla(var(--app-border))]">
        <table className="w-full px-8">
          <thead className="w-full border-b border-[hsla(var(--app-border))]">
            <tr>
              {Column.map((col, i) => {
                return (
                  <th
                    key={i}
                    className="px-4 py-2 text-left font-normal last:text-center"
                  >
                    {col}
                  </th>
                )
              })}
            </tr>
          </thead>
          {activeModels.map((model) => {
            return (
              <tbody key={model.model}>
                <tr>
                  <td
                    className="max-w-[200px] px-4 py-2 font-bold"
                    title={model.model}
                  >
                    <p className="line-clamp-2">{model.model}</p>
                  </td>
                  <td className="px-4 py-2">
                    <Badge theme="secondary">
                      {toGibibytes((model.metadata?.size ?? 0) as number)}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <Button
                      theme="destructive"
                      onClick={() => {
                        stopModel(model.model)
                      }}
                    >
                      Stop
                    </Button>
                  </td>
                </tr>
              </tbody>
            )
          })}
        </table>
      </div>
    </div>
  )
}

export default TableActiveModel
