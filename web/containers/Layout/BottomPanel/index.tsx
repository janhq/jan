import { Button, Tooltip } from '@janhq/joi'
import { useAtomValue } from 'jotai'

import { FaGithub, FaDiscord } from 'react-icons/fa'
import { twMerge } from 'tailwind-merge'

import DownloadingState from './DownloadingState'

import ImportingModelState from './ImportingModelState'
import SystemMonitor from './SystemMonitor'
import UpdateApp from './UpdateApp'
import UpdatedFailedModal from './UpdateFailedModal'

import { appDownloadProgressAtom } from '@/helpers/atoms/App.atom'
import { reduceTransparentAtom } from '@/helpers/atoms/Setting.atom'

const menuLinks = [
  {
    name: 'Discord',
    icon: <FaDiscord size={16} className="flex-shrink-0" />,
    link: 'https://discord.gg/FTk2MvZwJH',
  },
  {
    name: 'Github',
    icon: <FaGithub size={14} className="flex-shrink-0" />,
    link: 'https://github.com/janhq/jan',
  },
]

const BottomPanel = () => {
  const progress = useAtomValue(appDownloadProgressAtom)
  const reduceTransparent = useAtomValue(reduceTransparentAtom)

  return (
    <div
      className={twMerge(
        'fixed bottom-0 left-0 z-40 flex h-9 w-full items-center justify-between px-3 text-xs',
        reduceTransparent &&
          'border-t border-[hsla(var(--app-border))] bg-[hsla(var(--bottom-panel-bg))]'
      )}
    >
      <div className="flex flex-shrink-0 items-center gap-x-2">
        <div className="flex items-center space-x-2">
          {progress && progress > 0 ? (
            <UpdateApp total={100} used={progress} />
          ) : null}
        </div>
        <ImportingModelState />
        <DownloadingState />
        <UpdatedFailedModal />
      </div>
      <div className="flex items-center gap-x-1">
        <SystemMonitor />
        <span className="font-medium text-[hsla(var(--text-secondary))]">
          Jan v{VERSION ?? ''}
        </span>
        <div className="ml-2 flex items-center">
          {menuLinks
            .filter((link) => !!link)
            .map((link, i) => (
              <div className="relative" key={i}>
                <Tooltip
                  withArrow={false}
                  side="top"
                  trigger={
                    <Button theme="icon">
                      <a
                        href={link.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="relative flex w-full flex-shrink-0 items-center justify-center no-underline"
                      >
                        {link.icon}
                      </a>
                    </Button>
                  }
                  content={link.name}
                />
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

export default BottomPanel
