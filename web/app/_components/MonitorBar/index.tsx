import ProgressBar from '../ProgressBar'
import SystemItem from '../SystemItem'
import { useAtomValue } from 'jotai'
import { appDownloadProgress } from '@/_helpers/JotaiWrapper'
import useGetAppVersion from '@/_hooks/useGetAppVersion'
import useGetSystemResources from '@/_hooks/useGetSystemResources'
import { modelDownloadStateAtom } from '@/_helpers/atoms/DownloadState.atom'
import { DownloadState } from '@/_models/DownloadState'
import { formatDownloadPercentage } from '@/_utils/converter'
import { activeAssistantModelAtom } from '@/_helpers/atoms/Model.atom'

const MonitorBar: React.FC = () => {
  const progress = useAtomValue(appDownloadProgress)
  const activeModel = useAtomValue(activeAssistantModelAtom)
  const { version } = useGetAppVersion()
  const { ram, cpu } = useGetSystemResources()
  const modelDownloadStates = useAtomValue(modelDownloadStateAtom)

  const downloadStates: DownloadState[] = []
  for (const [, value] of Object.entries(modelDownloadStates)) {
    downloadStates.push(value)
  }

  return (
    <div className="flex flex-row items-center justify-between border-t border-gray-200">
      {progress && progress >= 0 ? (
        <ProgressBar total={100} used={progress} />
      ) : null}
      <div className="flex flex-1 items-center justify-end gap-8 px-2">
        {downloadStates.length > 0 && (
          <SystemItem
            name="Downloading"
            value={`${downloadStates[0].fileName}: ${formatDownloadPercentage(
              downloadStates[0].percent
            )}`}
          />
        )}
        <SystemItem name="CPU" value={`${cpu}%`} />
        <SystemItem name="Mem" value={`${ram}%`} />
        {activeModel && (
          <SystemItem name={`Active model: ${activeModel.name}`} value={''} />
        )}
        <span className="text-sm text-gray-900">v{version}</span>
      </div>
    </div>
  )
}

export default MonitorBar
