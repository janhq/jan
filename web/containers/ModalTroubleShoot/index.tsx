import { useState } from 'react'

import { Modal, ScrollArea } from '@janhq/joi'
import { motion as m } from 'framer-motion'
import { atom, useAtom } from 'jotai'
import { twMerge } from 'tailwind-merge'

import ServerLogs from '@/containers/ServerLogs'

import AppLogs from './AppLogs'
import DeviceSpecs from './DeviceSpecs'

export const modalTroubleShootingAtom = atom(false)
const logOption = ['App Logs', 'Server Logs', 'Device Specs']

const ModalTroubleShooting = () => {
  const [modalTroubleShooting, setModalTroubleShooting] = useAtom(
    modalTroubleShootingAtom
  )
  const [isTabActive, setIsTabActivbe] = useState(0)

  return (
    <Modal
      open={modalTroubleShooting}
      fullPage
      onOpenChange={setModalTroubleShooting}
      title="Troubleshooting Assistance"
      content={
        <div className="flex h-full w-full flex-col overflow-hidden ">
          <div className="flex-shrink-0">
            <p className="text-[hsla(var(--text-secondary)] mt-2 pr-3 leading-relaxed">
              {`We're here to help! Your report is crucial for debugging and shaping
          the next version. Here’s how you can report & get further support:`}
            </p>
          </div>

          <div className="my-3 rounded-lg border border-[hsla(var(--app-border))] p-4 shadow">
            <h2 className="font-semibold">Step 1</h2>
            <p className="text-[hsla(var(--text-secondary)] mt-1">
              Follow our&nbsp;
              <a
                href="https://jan.ai/guides/troubleshooting"
                target="_blank"
                className="text-[hsla(var(--text-link))] hover:underline"
              >
                troubleshooting guide
              </a>
              &nbsp;for step-by-step solutions.
            </p>
          </div>

          <div className="rounded-lg border border-[hsla(var(--app-border))]  pb-2 pt-4 shadow">
            <div className="px-4">
              <h2 className="font-semibold">Step 2</h2>
              <p className="text-[hsla(var(--text-secondary)] mt-1">
                {`If you can't find what you need in our troubleshooting guide, feel
            free reach out to us for extra help:`}
              </p>
              <ul className="mt-2 list-disc space-y-2 pl-6">
                <li>
                  <p className="font-medium">
                    Copy your 2-hour logs & device specifications provided
                    below.{' '}
                  </p>
                </li>
                <li>
                  <p className="font-medium">
                    Go to our&nbsp;
                    <a
                      href="https://discord.gg/AsJ8krTT3N"
                      target="_blank"
                      className="text-[hsla(var(--text-link))] hover:underline"
                    >
                      Discord
                    </a>
                    &nbsp;& send it to #🆘|get-help channel for further support.
                  </p>
                </li>
              </ul>
            </div>
            <div className="flex h-full w-full flex-col pt-4">
              <div className="relative border-y border-[hsla(var(--app-border))] px-4 py-2 ">
                <ul className="inline-flex space-x-2 rounded-lg px-1">
                  {logOption.map((name, i) => {
                    return (
                      <li
                        className="relative cursor-pointer px-4 py-2"
                        key={i}
                        onClick={() => setIsTabActivbe(i)}
                      >
                        <span
                          className={twMerge(
                            'text-[hsla(var(--text-secondary)] relative z-50 font-medium',
                            isTabActive === i &&
                              'bg= font-bold text-[hsla(var(--primary-fg))]'
                          )}
                        >
                          {name}
                        </span>
                        {isTabActive === i && (
                          <m.div
                            className="absolute left-0 top-1 h-[calc(100%-8px)] w-full rounded-md bg-[hsla(var(--primary-bg))]"
                            layoutId="log-state-active"
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
              <ScrollArea className="w-full">
                {isTabActive === 0 && <AppLogs />}
                {isTabActive === 1 && <ServerLogs limit={50} withCopy />}
                {isTabActive === 2 && <DeviceSpecs />}
              </ScrollArea>
            </div>
          </div>
        </div>
      }
    />
  )
}

export default ModalTroubleShooting
