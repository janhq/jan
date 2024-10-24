import { Tooltip, Button, Badge } from '@janhq/joi'

import { useAtom } from 'jotai'

import { useActiveModel } from '@/hooks/useActiveModel'

import { toGibibytes } from '@/utils/converter'

import { isLocalEngine } from '@/utils/modelEngine'

import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'

const Column = ['Model', 'Size', '']

const TableActiveModel = () => {
  const { activeModel, stateModel, stopModel } = useActiveModel()

  const [serverEnabled, setServerEnabled] = useAtom(serverEnabledAtom)

  return (
    <div className="w-1/2">
      <div className="overflow-hidden border-b border-[hsla(var(--app-border))]">
        <table className="w-full px-8">
          <thead className="w-full border-b border-[hsla(var(--app-border))] bg-[hsla(var(--tertiary-bg))]">
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
          {activeModel && isLocalEngine(activeModel.engine) ? (
            <tbody>
              <tr>
                <td
                  className="max-w-[200px] px-4 py-2 font-bold"
                  title={activeModel.name}
                >
                  <p className="line-clamp-2">{activeModel.name}</p>
                </td>
                <td className="px-4 py-2">
                  <Badge theme="secondary">
                    {activeModel.metadata?.size
                      ? toGibibytes(activeModel.metadata?.size)
                      : '-'}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-center">
                  <Tooltip
                    trigger={
                      <Button
                        theme={
                          stateModel.state === 'stop'
                            ? 'destructive'
                            : 'primary'
                        }
                        onClick={() => {
                          stopModel()
                          window.core?.api?.stopServer()
                          setServerEnabled(false)
                        }}
                      >
                        Stop
                      </Button>
                    }
                    content="The API server is running, stop the model will
                      also stop the server"
                    disabled={!serverEnabled}
                  />
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody>
              <tr className="text-[hsla(var(--text-secondary))]">
                <td className="p-4">No models are loaded into memory</td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
    </div>
  )
}

export default TableActiveModel
