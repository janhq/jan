import { useAtomValue } from 'jotai'

import ProgressBar from '@/components/ProgressBar'

import DownloadingState from '@/containers/Layout/BottomBar/DownloadingState'

import SystemItem from '@/containers/Layout/BottomBar/SystemItem'

import { appDownloadProgress } from '@/containers/Providers/Jotai'

import { useActiveModel } from '@/hooks/useActiveModel'
import { useGetAppVersion } from '@/hooks/useGetAppVersion'
import useGetSystemResources from '@/hooks/useGetSystemResources'

const BottomBar = () => {
  const { activeModel, stateModel } = useActiveModel()
  const { ram, cpu } = useGetSystemResources()
  const progress = useAtomValue(appDownloadProgress)
  const appVersion = useGetAppVersion()

  return (
    <div className="fixed bottom-0 left-16 z-20 flex h-12 w-[calc(100%-64px)] items-center justify-between border-t border-border bg-background/50 px-3">
      <div className="flex flex-shrink-0 items-center gap-x-2">
        <div className="flex items-center space-x-2">
          {!progress && progress === 0 ? (
            <ProgressBar total={100} used={progress} />
          ) : null}
        </div>

        {stateModel.state === 'start' && stateModel.loading && (
          <SystemItem name="Starting:" value={stateModel.model || '-'} />
        )}
        {stateModel.state === 'stop' && stateModel.loading && (
          <SystemItem name="Stopping:" value={stateModel.model || '-'} />
        )}
        {!stateModel.loading && (
          <SystemItem name="Active model:" value={activeModel?.name || '-'} />
        )}

        <DownloadingState />
      </div>
      <div className="flex gap-x-2">
        <SystemItem name="CPU:" value={`${cpu}%`} />
        <SystemItem name="Mem:" value={`${ram}%`} />
        <span className="text-xs font-semibold ">
          Jan v{appVersion?.version ?? ''}
        </span>
      </div>
    </div>
  )
}

export default BottomBar
