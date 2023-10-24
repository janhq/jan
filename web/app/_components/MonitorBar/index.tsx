import ProgressBar from '@/_components/ProgressBar'
import SystemItem from '@containers/SystemItem'
import { useAtomValue } from 'jotai'
import { appDownloadProgress } from '@helpers/JotaiWrapper'
import useGetAppVersion from '@hooks/useGetAppVersion'
import useGetSystemResources from '@hooks/useGetSystemResources'
import { modelDownloadStateAtom } from '@helpers/atoms/DownloadState.atom'
import { formatDownloadPercentage } from '@utils/converter'
import { activeAssistantModelAtom } from '@helpers/atoms/Model.atom'

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
    <div className="flex flex-row items-center justify-between">
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
        <span className="text-xs">v{version}</span>
      </div>
    </div>
  )
}

export default MonitorBar
