import React from 'react'
import SystemItem from '@containers/SystemItem'
import { useAtomValue } from 'jotai'
import useGetAppVersion from '@hooks/useGetAppVersion'
import useGetSystemResources from '@hooks/useGetSystemResources'
import { modelDownloadStateAtom } from '@helpers/atoms/DownloadState.atom'
import { formatDownloadPercentage } from '@utils/converter'
import { activeAssistantModelAtom } from '@helpers/atoms/Model.atom'

const BottomBar = () => {
  const activeModel = useAtomValue(activeAssistantModelAtom)
  const { version } = useGetAppVersion()
  const { ram, cpu } = useGetSystemResources()
  const modelDownloadStates = useAtomValue(modelDownloadStateAtom)
  const getCurrentYear = new Date().getFullYear()

  const downloadStates: DownloadState[] = []
  for (const [, value] of Object.entries(modelDownloadStates)) {
    downloadStates.push(value)
  }

  return (
    <div className="bg-background/50 border-border fixed bottom-0 left-0 z-50 flex h-8 w-full items-center justify-between border-t px-4">
      <div className="flex gap-x-2">
        <SystemItem name="Active model:" value={activeModel?.name || '-'} />
        {downloadStates.length > 0 && (
          <SystemItem
            name="Downloading:"
            value={`${downloadStates[0].fileName} - ${formatDownloadPercentage(
              downloadStates[0].percent
            )}`}
          />
        )}
      </div>
      <div className="flex gap-x-2">
        <SystemItem name="CPU:" value={`${cpu}%`} />
        <SystemItem name="Mem:" value={`${ram}%`} />
        <p className="text-muted-foreground text-xs">
          &copy;{getCurrentYear}&nbsp;Jan AI Pte Ltd. v{version}
        </p>
      </div>
    </div>
  )
}

export default BottomBar
