import React, { useEffect, useState } from 'react'

import { Button } from '@janhq/uikit'

import { CopyIcon, CheckIcon } from 'lucide-react'

import { useClipboard } from '@/hooks/useClipboard'
import { useLogs } from '@/hooks/useLogs'

// TODO @Louis help add missing information device specs
const DeviceSpecs = () => {
  const { getLogs } = useLogs()
  const [logs, setLogs] = useState<string[]>([])

  useEffect(() => {
    getLogs('app').then((log) => {
      if (typeof log?.split === 'function') {
        setLogs(
          log.split(/\r?\n|\r|\n/g).filter((e) => e.includes('[SPECS]::'))
        )
      }
    })

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const clipboard = useClipboard({ timeout: 1000 })

  return (
    <>
      <div className="absolute -top-11 right-2">
        <Button
          themes="outline"
          className="bg-white dark:bg-secondary/50"
          onClick={() => {
            clipboard.copy(logs.join('\n') ?? '')
          }}
        >
          <div className="flex items-center space-x-2">
            {clipboard.copied ? (
              <>
                <CheckIcon size={14} className="text-green-600" />
                <span>Copying...</span>
              </>
            ) : (
              <>
                <CopyIcon size={14} />
                <span>Copy All</span>
              </>
            )}
          </div>
        </Button>
      </div>
      <div>
        <div className="h-full overflow-auto">
          <code className="inline-block whitespace-pre-line text-xs">
            {logs.map((log, i) => {
              return (
                <p key={i} className="my-2 leading-relaxed">
                  {log}
                </p>
              )
            })}
          </code>
        </div>
      </div>
    </>
  )
}

export default DeviceSpecs
