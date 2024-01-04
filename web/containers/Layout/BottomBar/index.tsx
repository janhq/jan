import {
  Badge,
  Button,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipTrigger,
} from '@janhq/uikit'
import { useAtomValue } from 'jotai'

import { FaGithub, FaDiscord } from 'react-icons/fa'

import DownloadingState from '@/containers/Layout/BottomBar/DownloadingState'

import SystemItem from '@/containers/Layout/BottomBar/SystemItem'
import ProgressBar from '@/containers/ProgressBar'

import { appDownloadProgress } from '@/containers/Providers/Jotai'

import ShortCut from '@/containers/Shortcut'

import { MainViewState } from '@/constants/screens'

import { useActiveModel } from '@/hooks/useActiveModel'

import { useDownloadState } from '@/hooks/useDownloadState'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'
import useGetSystemResources from '@/hooks/useGetSystemResources'
import { useMainViewState } from '@/hooks/useMainViewState'

const BottomBar = () => {
  const { activeModel, stateModel } = useActiveModel()
  const { ram, cpu } = useGetSystemResources()
  const progress = useAtomValue(appDownloadProgress)
  const { downloadedModels } = useGetDownloadedModels()
  const { setMainViewState } = useMainViewState()
  const { downloadStates } = useDownloadState()

  const linksMenu = [
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

  return (
    <div className="fixed bottom-0 left-16 z-20 flex h-12 w-[calc(100%-64px)] items-center justify-between border-t border-border bg-background/80 px-3">
      <div className="flex flex-shrink-0 items-center gap-x-2">
        <div className="flex items-center space-x-2">
          {progress && progress > 0 ? (
            <ProgressBar total={100} used={progress} />
          ) : null}
        </div>

        {stateModel.state === 'start' && stateModel.loading && (
          <SystemItem name="Starting:" value={stateModel.model || '-'} />
        )}
        {stateModel.state === 'stop' && stateModel.loading && (
          <SystemItem name="Stopping:" value={stateModel.model || '-'} />
        )}
        {!stateModel.loading && downloadedModels.length !== 0 && (
          <SystemItem
            name={activeModel?.id ? 'Active model:' : ''}
            value={
              activeModel?.id || (
                <Badge themes="outline" className="pl-1">
                  <ShortCut menu="E" />
                  &nbsp; to view models
                </Badge>
              )
            }
          />
        )}
        {downloadedModels.length === 0 &&
          !stateModel.loading &&
          downloadStates.length === 0 && (
            <Button
              size="sm"
              themes="outline"
              onClick={() => setMainViewState(MainViewState.Hub)}
            >
              Download your first model
            </Button>
          )}

        <DownloadingState />
      </div>
      <div className="flex items-center gap-x-4">
        <div className="flex items-center gap-x-2">
          <SystemItem name="CPU:" value={`${cpu}%`} />
          <SystemItem name="Mem:" value={`${ram}%`} />
        </div>
        {/* VERSION is defined by webpack, please see next.config.js */}
        <span className="text-xs">Jan v{VERSION ?? ''}</span>
        <div className="mt-1 flex items-center gap-x-2">
          {linksMenu
            .filter((link) => !!link)
            .map((link, i) => {
              return (
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
              )
            })}
        </div>
      </div>
    </div>
  )
}

export default BottomBar
