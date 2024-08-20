import { Compatibility, InstallationState } from '@janhq/core/.'
import { Button, Progress, Tooltip } from '@janhq/joi'
import { InfoCircledIcon } from '@radix-ui/react-icons'

type InstallStateProps = {
  installProgress: number
  compatibility?: Compatibility
  installState: InstallationState
  onInstallClick: () => void
  onCancelClick: () => void
}

const InstallStateIndicator: React.FC<InstallStateProps> = ({
  installProgress,
  compatibility,
  installState,
  onInstallClick,
  onCancelClick,
}) => {
  if (installProgress !== -1) {
    const progress = installProgress * 100
    return (
      <div className="text-primary dark flex h-10 flex-row items-center justify-center space-x-2 rounded-lg px-4">
        <button onClick={onCancelClick} className="text-primary font-semibold">
          Cancel
        </button>
        <div className="flex w-[113px] flex-row items-center justify-center space-x-2 rounded-md px-2 py-[2px]">
          <Progress className="h-1 w-[69px]" value={progress} />
          <span className="text-primary text-xs font-bold">
            {progress.toFixed(0)}%
          </span>
        </div>
      </div>
    )
  }

  switch (installState) {
    case 'Installed':
      return (
        <div className="rounded-md px-3 py-1.5 font-semibold text-[hsla(var(--text-secondary))]">
          Installed
        </div>
      )
    case 'NotCompatible':
      return (
        <div className="rounded-md px-3 py-1.5 font-semibold text-[hsla(var(--text-secondary))]">
          <div className="flex flex-row items-center justify-center gap-1">
            Incompatible
            <Tooltip
              trigger={
                <InfoCircledIcon className="cursor-pointer text-[hsla(var(--text-secondary))]" />
              }
              content={
                compatibility &&
                !compatibility['platform']?.includes(PLATFORM) ? (
                  <span>
                    Only available on&nbsp;
                    {compatibility?.platform
                      ?.map((e: string) =>
                        e === 'win32'
                          ? 'Windows'
                          : e === 'linux'
                            ? 'Linux'
                            : 'MacOS'
                      )
                      .join(', ')}
                  </span>
                ) : (
                  <span>Your GPUs are not compatible with this extension</span>
                )
              }
            />
          </div>
        </div>
      )
    case 'NotInstalled':
      return (
        <Button size="small" variant="soft" onClick={onInstallClick}>
          Install
        </Button>
      )
    default:
      return <div></div>
  }
}

export default InstallStateIndicator
