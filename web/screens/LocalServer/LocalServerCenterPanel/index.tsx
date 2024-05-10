import { useState } from 'react'

import { Button } from '@janhq/joi'
import { CodeIcon, Paintbrush } from 'lucide-react'

import ServerLogs from '@/containers/ServerLogs'

import { useLogs } from '@/hooks/useLogs'

const FIRST_TIME_VISIT_API_SERVER = 'firstTimeVisitAPIServer'

const LocalServerCenterPanel = () => {
  const { openServerLog, clearServerLog } = useLogs()

  const [firstTimeVisitAPIServer, setFirstTimeVisitAPIServer] =
    useState<boolean>(false)

  return (
    <div className="relative flex h-full w-full flex-col bg-[hsla(var(--app-bg))]">
      <div className="sticky top-0 flex  items-center justify-between border-b border-[hsla(var(--app-border))] px-4 py-2">
        <h2 className="font-bold">Server Logs</h2>
        <div className="space-x-2">
          <Button
            size="small"
            theme="ghost"
            variant="outline"
            onClick={() => openServerLog()}
          >
            <CodeIcon size={16} className="mr-2" />
            Open Logs
          </Button>
          <Button
            size="small"
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
          <div className="w-[335px] rounded-lg border border-blue-600 bg-blue-100 p-6">
            <div className="item-start flex gap-x-4">
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                className="mt-1 flex-shrink-0"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M10 20C15.5228 20 20 15.5228 20 10C20 4.47715 15.5228 0 10 0C4.47715 0 2.11188e-08 4.47715 2.11188e-08 10C2.11188e-08 12.397 0.843343 14.597 2.2495 16.3195L0.292453 18.2929C-0.332289 18.9229 0.110179 20 0.993697 20H10ZM5.5 8C5.5 7.44772 5.94772 7 6.5 7H13.5C14.0523 7 14.5 7.44772 14.5 8C14.5 8.55229 14.0523 9 13.5 9H6.5C5.94772 9 5.5 8.55229 5.5 8ZM6.5 11C5.94772 11 5.5 11.4477 5.5 12C5.5 12.5523 5.94772 13 6.5 13H9.5C10.0523 13 10.5 12.5523 10.5 12C10.5 11.4477 10.0523 11 9.5 11H6.5Z"
                  fill="#2563EB"
                />
              </svg>

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
        <div className="p-4">
          <ServerLogs />
        </div>
      )}
    </div>
  )
}

export default LocalServerCenterPanel
