import { Fragment } from 'react'

import { Tooltip, Button, Badge } from '@janhq/joi'

import { useAtom } from 'jotai'

import { useActiveModel } from '@/hooks/useActiveModel'

import { toGibibytes } from '@/utils/converter'

import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'

const Column = ['Name', 'Model ID', 'Size', 'Version', 'Action']

const TableActiveModel = () => {
  const { activeModel, stateModel, stopModel } = useActiveModel()
  const [serverEnabled, setServerEnabled] = useAtom(serverEnabledAtom)

  return (
    <div className="m-4 mr-0 w-full">
      <div className="overflow-hidden rounded-lg border border-[hsla(var(--app-border))] shadow-sm">
        <table className="w-full px-8">
          <thead className="w-full border-b border-[hsla(var(--app-border))] bg-secondary">
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
          {activeModel && (
            <Fragment>
              <tbody>
                <tr>
                  <td
                    className="max-w-[200px] px-4 py-2 font-bold"
                    title={activeModel.name}
                  >
                    <p className="line-clamp-2">{activeModel.name}</p>
                  </td>
                  <td
                    className="max-w-[200px] px-4 py-2 font-bold"
                    title={activeModel.id}
                  >
                    <p className="line-clamp-2">{activeModel.id}</p>
                  </td>
                  <td className="px-4 py-2">
                    <Badge theme="secondary">
                      {toGibibytes(activeModel.metadata.size)}
                    </Badge>
                  </td>
                  <td className="px-4 py-2">
                    <Badge theme="secondary">v{activeModel.version}</Badge>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <Tooltip
                      trigger={
                        <Button
                          block
                          theme={
                            stateModel.state === 'stop'
                              ? 'destructive'
                              : 'primary'
                          }
                          className="w-16"
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
            </Fragment>
          )}
        </table>
      </div>
    </div>
  )
}

export default TableActiveModel
