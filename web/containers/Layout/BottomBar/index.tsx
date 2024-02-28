import {
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipTrigger,
} from '@janhq/uikit'
import { useAtomValue } from 'jotai'

import { FaGithub, FaDiscord } from 'react-icons/fa'

import DownloadingState from '@/containers/Layout/BottomBar/DownloadingState'

import CommandListDownloadedModel from '@/containers/Layout/TopBar/CommandListDownloadedModel'
import ProgressBar from '@/containers/ProgressBar'

import { appDownloadProgress } from '@/containers/Providers/Jotai'

import ImportingModelState from './ImportingModelState'
import SystemMonitor from './SystemMonitor'

const menuLinks = [
  {
    name: 'Discord',
    icon: <FaDiscord size={20} className="flex-shrink-0" />,
    link: 'https://discord.gg/FTk2MvZwJH',
  },
  {
    name: 'Github',
    icon: <FaGithub size={16} className="flex-shrink-0" />,
    link: 'https://github.com/janhq/jan',
  },
]

const BottomBar = () => {
  const progress = useAtomValue(appDownloadProgress)

  return (
    <div className="fixed bottom-0 left-16 z-50 flex h-12 w-[calc(100%-64px)] items-center justify-between border-t border-border bg-background/80 px-3">
      <div className="flex flex-shrink-0 items-center gap-x-2">
        <div className="flex items-center space-x-2">
          {progress && progress > 0 ? (
            <ProgressBar total={100} used={progress} />
          ) : null}
        </div>
        <ImportingModelState />
        <DownloadingState />
      </div>
      <div className="flex items-center gap-x-3">
        <SystemMonitor />

        {/* VERSION is defined by webpack, please see next.config.js */}
        <span className="text-xs text-muted-foreground">
          Jan v{VERSION ?? ''}
        </span>
        <div className="mt-1 flex items-center gap-x-2">
          {menuLinks
            .filter((link) => !!link)
            .map((link, i) => (
              <div className="relative" key={i}>
                <Tooltip>
                  <TooltipTrigger>
                    <a
                      href={link.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative flex w-full flex-shrink-0 cursor-pointer items-center justify-center"
                    >
                      {link.icon}
                    </a>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={10}>
                    <span>{link.name}</span>
                    <TooltipArrow />
                  </TooltipContent>
                </Tooltip>
              </div>
            ))}
        </div>
      </div>
      <CommandListDownloadedModel />
    </div>
  )
}

export default BottomBar
