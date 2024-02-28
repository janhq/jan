import { useState } from 'react'
import ScrollToBottom from 'react-scroll-to-bottom'

import { Modal, ModalContent, ModalHeader, ModalTitle } from '@janhq/uikit'
import { motion as m } from 'framer-motion'
import { atom, useAtom } from 'jotai'
import { twMerge } from 'tailwind-merge'

import ServerLogs from '../ServerLogs'

import AppLogs from './AppLogs'
import DeviceSpecs from './DeviceSpecs'

export const modalTroubleShootingAtom = atom(false)
const logOption = ['App Logs', 'Server Logs', 'Device Specs']

const ModalTroubleShooting: React.FC = () => {
  const [modalTroubleShooting, setModalTroubleShooting] = useAtom(
    modalTroubleShootingAtom
  )
  const [isTabActive, setIsTabActivbe] = useState(0)

  return (
    <Modal open={modalTroubleShooting} onOpenChange={setModalTroubleShooting}>
      <ModalContent className="max-w-[60%] pb-4 pt-8">
        <ModalHeader>
          <ModalTitle>Troubleshooting Assistance</ModalTitle>
        </ModalHeader>
        <p className="-mt-2 pr-3 leading-relaxed text-muted-foreground">
          {`We're here to help! Your report is crucial for debugging and shaping
          the next version. Here’s how you can report & get further support:`}
        </p>

        <div className="rounded-lg border border-border p-4 shadow">
          <h2 className="font-semibold">Step 1</h2>
          <p className="mt-1 text-muted-foreground">
            Follow our&nbsp;
            <a
              href="https://jan.ai/guides/troubleshooting"
              target="_blank"
              className="text-blue-600 hover:underline"
            >
              troubleshooting guide
            </a>
            &nbsp;for step-by-step solutions.
          </p>
        </div>

        <div className="block overflow-hidden rounded-lg border border-border pb-2 pt-4 shadow">
          <div className="px-4">
            <h2 className="font-semibold">Step 2</h2>
            <p className="mt-1 text-muted-foreground">
              {`If you can't find what you need in our troubleshooting guide, feel
            free reach out to us for extra help:`}
            </p>
            <ul className="mt-2 list-disc space-y-2 pl-6">
              <li>
                <p className="font-medium">
                  Copy your 2-hour logs & device specifications provided below.{' '}
                </p>
              </li>
              <li>
                <p className="font-medium">
                  Go to our&nbsp;
                  <a
                    href="https://discord.gg/AsJ8krTT3N"
                    target="_blank"
                    className="text-blue-600 hover:underline"
                  >
                    Discord
                  </a>
                  &nbsp;& send it to #🆘|get-help channel for further support.
                </p>
              </li>
            </ul>
          </div>

          <div className="flex flex-col pt-4">
            {/* TODO @faisal replace this once we have better tabs component UI */}
            <div className="relative bg-zinc-100 px-4 py-2">
              <ul className="inline-flex space-x-2 rounded-lg bg-zinc-200 px-1">
                {logOption.map((name, i) => {
                  return (
                    <li
                      className="relative cursor-pointer px-4 py-2"
                      key={i}
                      onClick={() => setIsTabActivbe(i)}
                    >
                      <span
                        className={twMerge(
                          'relative z-50 font-medium text-muted-foreground',
                          isTabActive === i && 'font-bold text-foreground'
                        )}
                      >
                        {name}
                      </span>
                      {isTabActive === i && (
                        <m.div
                          className="absolute left-0 top-1 h-[calc(100%-8px)] w-full rounded-md bg-background"
                          layoutId="log-state-active"
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
            <ScrollToBottom className={twMerge('relative h-[140px] px-4 py-2')}>
              {isTabActive === 0 && <AppLogs />}
              {isTabActive === 1 && <ServerLogs limit={50} withCopy />}
              {isTabActive === 2 && <DeviceSpecs />}
            </ScrollToBottom>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

export default ModalTroubleShooting
