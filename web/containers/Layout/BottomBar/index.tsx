import { useAtomValue } from 'jotai'

import DownloadingState from '@/containers/Layout/BottomBar/DownloadingState'

import ProgressBar from '@/containers/ProgressBar'

import { appDownloadProgress } from '@/containers/Providers/Jotai'

import ImportingModelState from './ImportingModelState'
import InstallingExtension from './InstallingExtension'
import SystemMonitor from './SystemMonitor'
import UpdatedFailedModal from './UpdateFailedModal'

const BottomBar = () => {
  const progress = useAtomValue(appDownloadProgress)

  return (
    <div className="fixed bottom-0 left-0 z-50 flex h-[28px] w-full items-center justify-between border-t border-[hsla(var(--bottom-bar-border-b,var(--app-border)))] bg-[hsla(var(--top-bar-bg,var(--app-bg)))] px-3 text-xs">
      <div className="flex flex-shrink-0 items-center gap-x-2">
        <div className="flex items-center space-x-2">
          {progress && progress > 0 ? (
            <ProgressBar total={100} used={progress} />
          ) : null}
        </div>
        <ImportingModelState />
        <DownloadingState />
        <UpdatedFailedModal />
        <InstallingExtension />
      </div>
      <div className="flex items-center gap-x-1">
        <SystemMonitor />
        <span className="font-medium text-[hsla(var(--app-text-secondary))]">
          Jan v{VERSION ?? ''}
        </span>
      </div>
    </div>
  )
}

export default BottomBar
