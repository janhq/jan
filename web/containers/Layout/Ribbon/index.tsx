import { useEffect, useState } from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipArrow,
  Modal,
  ModalTitle,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalDescription,
  ModalClose,
  Button,
} from '@janhq/uikit'
import { motion as m } from 'framer-motion'

import { useAtomValue } from 'jotai'
import {
  MessageCircleIcon,
  SettingsIcon,
  MonitorIcon,
  LayoutGridIcon,
  Twitter,
  Github,
} from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import LogoMark from '@/containers/Brand/Logo/Mark'

import { MainViewState } from '@/constants/screens'

import { useMainViewState } from '@/hooks/useMainViewState'

import { threadSettingFormUpdateAtom } from '@/helpers/atoms/Thread.atom'

export default function RibbonNav() {
  const { mainViewState, setMainViewState } = useMainViewState()
  const threadSettingFormUpdate = useAtomValue(threadSettingFormUpdateAtom)
  const [showModalUpdateThreadSetting, setshowModalUpdateThreadSetting] =
    useState({ show: false, view: mainViewState })

  const onMenuClick = (state: MainViewState) => {
    if (mainViewState === state) return
    setMainViewState(state)
  }

  const primaryMenus = [
    {
      name: 'Thread',
      icon: (
        <MessageCircleIcon
          size={20}
          className="flex-shrink-0 text-muted-foreground"
        />
      ),
      state: MainViewState.Thread,
    },
    {
      name: 'Hub',
      icon: (
        <LayoutGridIcon
          size={20}
          className="flex-shrink-0 text-muted-foreground"
        />
      ),
      state: MainViewState.Hub,
    },
  ]

  const linksMenu = [
    {
      name: 'Twitter',
      icon: (
        <Twitter size={20} className="flex-shrink-0 text-muted-foreground" />
      ),
      link: 'https://twitter.com/janhq_',
    },
    {
      name: 'Github',
      icon: (
        <Github size={20} className="flex-shrink-0 text-muted-foreground" />
      ),
      link: 'https://github.com/janhq/jan',
    },
  ]

  const secondaryMenus = [
    {
      name: 'System Monitor',
      icon: (
        <MonitorIcon
          size={20}
          className="flex-shrink-0 text-muted-foreground"
        />
      ),
      state: MainViewState.SystemMonitor,
    },
    {
      name: 'Settings',
      icon: (
        <SettingsIcon
          size={20}
          className="flex-shrink-0 text-muted-foreground"
        />
      ),
      state: MainViewState.Settings,
    },
  ]

  return (
    <div className="relative top-12 flex h-[calc(100%-48px)] w-16 flex-shrink-0 flex-col border-r border-border bg-background py-4">
      <div className="mt-2 flex h-full w-full flex-col items-center justify-between">
        <div className="flex h-full w-full flex-col items-center justify-between">
          <div>
            <div className="unselect mb-4">
              <LogoMark width={28} height={28} className="mx-auto" />
            </div>
            {primaryMenus
              .filter((primary) => !!primary)
              .map((primary, i) => {
                const isActive = mainViewState === primary.state
                return (
                  <div className="relative flex p-2" key={i}>
                    <Tooltip>
                      <TooltipTrigger>
                        <div
                          data-testid={primary.name}
                          className={twMerge(
                            'relative flex w-full flex-shrink-0 cursor-pointer items-center justify-center',
                            isActive && 'z-10'
                          )}
                          onClick={() => {
                            if (
                              threadSettingFormUpdate &&
                              mainViewState === MainViewState.Thread
                            ) {
                              setshowModalUpdateThreadSetting({
                                show: true,
                                view: primary.state,
                              })
                            } else {
                              setshowModalUpdateThreadSetting({
                                show: false,
                                view: mainViewState,
                              })
                              onMenuClick(primary.state)
                            }
                          }}
                        >
                          {primary.icon}
                        </div>
                        {isActive && (
                          <m.div
                            className="absolute inset-0 left-0 h-full w-full rounded-md bg-gray-200 dark:bg-secondary"
                            layoutId="active-state-primary"
                          />
                        )}
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={10}>
                        <span>{primary.name}</span>
                        <TooltipArrow />
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )
              })}
          </div>

          <div>
            <>
              {linksMenu
                .filter((link) => !!link)
                .map((link, i) => {
                  return (
                    <div className="relative flex p-2" key={i}>
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
                        <TooltipContent side="right" sideOffset={10}>
                          <span>{link.name}</span>
                          <TooltipArrow />
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  )
                })}
            </>
            {secondaryMenus
              .filter((secondary) => !!secondary)
              .map((secondary, i) => {
                const isActive = mainViewState === secondary.state
                return (
                  <div className="relative flex p-2" key={i}>
                    <Tooltip>
                      <TooltipTrigger>
                        <div
                          data-testid={secondary.name}
                          className={twMerge(
                            'relative flex w-full flex-shrink-0 cursor-pointer items-center justify-center',
                            isActive && 'z-10'
                          )}
                          onClick={() => {
                            if (
                              threadSettingFormUpdate &&
                              mainViewState === MainViewState.Thread
                            ) {
                              setshowModalUpdateThreadSetting({
                                show: true,
                                view: secondary.state,
                              })
                            } else {
                              setshowModalUpdateThreadSetting({
                                show: false,
                                view: mainViewState,
                              })
                              onMenuClick(secondary.state)
                            }
                          }}
                        >
                          {secondary.icon}
                        </div>
                        {isActive && (
                          <m.div
                            className="absolute inset-0 left-0 h-full w-full rounded-md bg-gray-200 dark:bg-secondary"
                            layoutId="active-state-secondary"
                          />
                        )}
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={10}>
                        <span>{secondary.name}</span>
                        <TooltipArrow />
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )
              })}
          </div>
        </div>
      </div>

      <Modal
        open={showModalUpdateThreadSetting.show}
        onOpenChange={() =>
          setshowModalUpdateThreadSetting({
            show: false,
            view: mainViewState,
          })
        }
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              <div className="text-lg">Unsave changes</div>
            </ModalTitle>
            <ModalDescription>
              <p className="mb-2">
                You have unsave changes. Are you sure you want to leave this
                page?
              </p>
            </ModalDescription>
          </ModalHeader>
          <ModalFooter>
            <div className="flex gap-x-2">
              <ModalClose asChild>
                <Button themes="secondary" block>
                  Stay
                </Button>
              </ModalClose>
              <Button
                themes="danger"
                block
                onClick={() => {
                  setshowModalUpdateThreadSetting({
                    show: false,
                    view: mainViewState,
                  })
                  onMenuClick(showModalUpdateThreadSetting.view)
                }}
              >
                Leave
              </Button>
            </div>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
