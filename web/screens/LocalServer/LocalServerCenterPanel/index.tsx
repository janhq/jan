import { useEffect, useState } from 'react'

import { Button } from '@janhq/joi'
import { CodeIcon, Paintbrush } from 'lucide-react'

import { InfoIcon } from 'lucide-react'

import ServerLogs from '@/containers/ServerLogs'

import { useLogs } from '@/hooks/useLogs'

const FIRST_TIME_VISIT_API_SERVER = 'firstTimeVisitAPIServer'

const LocalServerCenterPanel = () => {
  const { openServerLog, clearServerLog } = useLogs()

  const [firstTimeVisitAPIServer, setFirstTimeVisitAPIServer] =
    useState<boolean>(false)

  useEffect(() => {
    if (localStorage.getItem(FIRST_TIME_VISIT_API_SERVER) == null) {
      setFirstTimeVisitAPIServer(true)
    }
  }, [firstTimeVisitAPIServer])

  return (
    <div className="flex h-full w-full flex-col overflow-x-hidden bg-[hsla(var(--app-bg))]">
      <div className="sticky top-0 flex  items-center justify-between border-b border-[hsla(var(--app-border))] px-4 py-2">
        <h2 className="font-bold">Server Logs</h2>
        <div className="space-x-2">
          <Button
            theme="ghost"
            variant="outline"
            onClick={() => openServerLog()}
          >
            <CodeIcon size={16} className="mr-2" />
            Open Logs
          </Button>
          <Button
            theme="ghost"
            variant="outline"
            onClick={() => clearServerLog()}
          >
            <Paintbrush size={16} className="mr-2" />
            Clear
          </Button>
        </div>
      </div>
      {firstTimeVisitAPIServer ? (
        <div className="flex h-full items-center justify-center">
          <div className="w-[335px] rounded-lg border p-6">
            <div className="item-start flex gap-x-4">
              <InfoIcon className="flex-shrink-0 text-[hsla(var(--info-bg))]" />
              <div>
                <h6 className="font-medium text-black">
                  Once you start the server, you cannot chat with your
                  assistant.
                </h6>
                <Button
                  className="mt-4"
                  onClick={() => {
                    localStorage.setItem(FIRST_TIME_VISIT_API_SERVER, 'false')
                    setFirstTimeVisitAPIServer(false)
                  }}
                >
                  Got it
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex w-full">
          <ServerLogs />
        </div>
      )}
    </div>
  )
}

export default LocalServerCenterPanel
