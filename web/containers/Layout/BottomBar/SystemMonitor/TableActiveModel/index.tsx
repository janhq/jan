import { Fragment } from 'react'

import {
  Tooltip,
  TooltipTrigger,
  Button,
  TooltipPortal,
  Badge,
  TooltipContent,
  TooltipArrow,
} from '@janhq/uikit'

import { useAtom } from 'jotai'

import { useActiveModel } from '@/hooks/useActiveModel'

import { toGibibytes } from '@/utils/converter'

import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'

const Column = ['Name', 'Model ID', 'Size', 'Version', 'Action']

const TableActiveModel = () => {
  const { activeModel, stateModel, stopModel } = useActiveModel()
  const [serverEnabled, setServerEnabled] = useAtom(serverEnabledAtom)

  return (
    <div className="m-4 mr-0 w-2/3 flex-shrink-0">
      <div className="overflow-hidden rounded-lg border border-border shadow-sm">
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
          {activeModel && (
            <Fragment>
              <tbody>
                <tr>
                  <td className="px-6 py-2 font-bold">{activeModel.name}</td>
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
                    <Tooltip>
                      <TooltipTrigger className="w-full">
                        <Button
                          block
                          themes={
                            stateModel.state === 'stop' ? 'danger' : 'primary'
                          }
                          className="w-16"
                          loading={stateModel.loading}
                          onClick={() => {
                            stopModel()
                            window.core?.api?.stopServer()
                            setServerEnabled(false)
                          }}
                        >
                          Stop
                        </Button>
                      </TooltipTrigger>
                      {serverEnabled && (
                        <TooltipPortal>
                          <TooltipContent side="top">
                            <span>
                              The API server is running, stop the model will
                              also stop the server
                            </span>
                            <TooltipArrow />
                          </TooltipContent>
                        </TooltipPortal>
                      )}
                    </Tooltip>
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
