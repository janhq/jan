import React, { useEffect, useState, memo } from 'react'

import { Button } from '@janhq/joi'

import { CopyIcon, CheckIcon, FolderIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { useClipboard } from '@/hooks/useClipboard'
import { useLogs } from '@/hooks/useLogs'
import { usePath } from '@/hooks/usePath'

import EmptyIcon from '@/screens/HubScreen2/components/EmptyIcon'

const AppLogs = () => {
  const { getLogs } = useLogs()
  const [logs, setLogs] = useState<string[]>([])
  const { onRevealInFinder } = usePath()

  useEffect(() => {
    getLogs('app').then((log) => {
      if (typeof log?.split === 'function') {
        if (log.length > 0) {
          setLogs(log.split(/\r?\n|\r|\n/g))
        }
      }
    })

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clipboard = useClipboard({ timeout: 1000 })

  return (
    <div
      className={twMerge(
        'max-w-[50vw] p-4 pb-0',
        logs.length === 0 && 'w-full max-w-none'
      )}
    >
      <div className="absolute right-2 top-7">
        <div className="flex w-full flex-row items-center gap-2">
          <Button
            theme="ghost"
            variant="outline"
            onClick={() => onRevealInFinder('Logs')}
          >
            <div className="flex items-center space-x-2">
              <>
                <FolderIcon size={14} />
                <span>Open</span>
              </>
            </div>
          </Button>
          <Button
            theme="ghost"
            variant="outline"
            onClick={() => {
              clipboard.copy(logs.slice(-50).join('\n') ?? '')
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
      </div>
      <div className="flex h-full w-full flex-col">
        {logs.length > 0 ? (
          <code className="inline-block whitespace-break-spaces text-[13px]">
            {logs.slice(-100).map((log, i) => {
              return (
                <p key={i} className="my-2 leading-relaxed">
                  {log}
                </p>
              )
            })}
          </code>
        ) : (
          <div className="flex flex-col items-center justify-center py-2">
            <EmptyIcon />
            <p className="text-[hsla(var(--text-secondary)] mt-4">Empty logs</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(AppLogs)
