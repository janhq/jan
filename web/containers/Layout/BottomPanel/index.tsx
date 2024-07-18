import { Button, Tooltip } from '@janhq/joi'
import { useAtomValue } from 'jotai'

import { twMerge } from 'tailwind-merge'

import Discord from '@/components/Discord'

import GitHub from '@/components/GitHub'

import DownloadingStatus from './DownloadingStatus'

import ImportingModelState from './ImportingModelState'
import InstallingExtension from './InstallingExtension'
import SystemMonitor from './SystemMonitor'
import UpdateApp from './UpdateApp'
import UpdatedFailedModal from './UpdateFailedModal'

import { appDownloadProgressAtom } from '@/helpers/atoms/App.atom'
import { reduceTransparentAtom } from '@/helpers/atoms/Setting.atom'

const menuLinks = [
  {
    name: 'Discord',
    icon: <Discord />,
    link: 'https://discord.gg/FTk2MvZwJH',
  },
  {
    name: 'Github',
    icon: <GitHub />,
    link: 'https://github.com/janhq/jan',
  },
]

const BottomPanel = () => {
  const progress = useAtomValue(appDownloadProgressAtom)
  const reduceTransparent = useAtomValue(reduceTransparentAtom)

  return (
    <div
      className={twMerge(
        'fixed bottom-0 left-0 z-50 flex h-9 w-full items-center justify-between px-3 text-xs',
        reduceTransparent &&
          'border-t border-[hsla(var(--app-border))] bg-[hsla(var(--bottom-panel-bg))]'
      )}
    >
      <div className="flex flex-1 items-center gap-x-2">
        <div className="flex items-center space-x-2">
          {progress && progress > 0 ? (
            <UpdateApp total={100} used={progress} />
          ) : null}
        </div>
        <ImportingModelState />
        <DownloadingStatus />
        <UpdatedFailedModal />
        <InstallingExtension />
      </div>
      <div className="flex flex-shrink-0 items-center gap-x-1">
        <SystemMonitor />
        <span className="font-medium text-[hsla(var(--text-secondary))]">
          Jan v{VERSION ?? ''}
        </span>
        <div className="ml-2 flex items-center">
          {menuLinks
            .filter((link) => !!link)
            .map((link) => (
              <Tooltip
                key={link.name}
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
            ))}
        </div>
      </div>
    </div>
  )
}

export default BottomPanel
