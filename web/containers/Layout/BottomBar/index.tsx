import { useAtomValue } from 'jotai'

import ProgressBar from '@/components/ProgressBar'

import SystemItem from '@/containers/Layout/BottomBar/SystemItem'

import { appDownloadProgress } from '@/containers/Providers/Jotai'

import { useDownloadState } from '@/hooks/useDownloadState'
import useGetAppVersion from '@/hooks/useGetAppVersion'
import useGetSystemResources from '@/hooks/useGetSystemResources'

import { formatDownloadPercentage } from '@/utils/converter'

import {
  activeAssistantModelAtom,
  stateModel,
} from '@/helpers/atoms/Model.atom'

const BottomBar = () => {
  const activeModel = useAtomValue(activeModelAtom)
  const stateModelStartStop = useAtomValue(stateModel)
  const { ram, cpu } = useGetSystemResources()
  const appVersion = useGetAppVersion()
  const progress = useAtomValue(appDownloadProgress)
  const { downloadStates } = useDownloadState()

  return (
    <div className="fixed bottom-0 left-16 z-20 flex h-8 w-[calc(100%-64px)] items-center justify-between border-t border-border bg-background/50 px-3">
      <div className="flex flex-shrink-0 items-center gap-x-2">
        <div className="flex items-center space-x-2">
          {progress && progress >= 0 ? (
            <ProgressBar total={100} used={progress} />
          ) : null}

          {downloadStates.length > 1 && (
            <SystemItem
              name="Downloading"
              value={`${downloadStates[0]
                ?.fileName}: ${formatDownloadPercentage(
                downloadStates[0]?.percent
              )}`}
            />
          )}
        </div>

        {stateModelStartStop.state === 'start' &&
          stateModelStartStop.loading && (
            <SystemItem
              name="Starting:"
              value={stateModelStartStop.model || '-'}
            />
          )}
        {stateModelStartStop.state === 'stop' &&
          stateModelStartStop.loading && (
            <SystemItem
              name="Stopping:"
              value={stateModelStartStop.model || '-'}
            />
          )}
        {!stateModelStartStop.loading && (
          <SystemItem name="Active model:" value={activeModel?.name || '-'} />
        )}
      </div>
      <div className="flex gap-x-2">
        <SystemItem name="CPU:" value={`${cpu}%`} />
        <SystemItem name="Mem:" value={`${ram}%`} />
        <p className="font-semibold">Jan v{appVersion?.version ?? ''}</p>
      </div>
    </div>
  )
}

export default BottomBar
