import { useState } from 'react'

import { Button, Modal } from '@janhq/joi'
import { atom, useAtom } from 'jotai'
import { Maximize2 } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import ServerLogs from '@/containers/ServerLogs'

import AppLogs from './AppLogs'
import CortexLogs from './CortexLogs'
import DeviceSpecs from './DeviceSpecs'

export const modalTroubleShootingAtom = atom(false)
const logOption = ['App Logs', 'Cortex Logs', 'Server Logs', 'Device Specs']

const ModalTroubleShooting = () => {
  const [modalTroubleShooting, setModalTroubleShooting] = useAtom(
    modalTroubleShootingAtom
  )
  const [isTabActive, setIsTabActivbe] = useState(0)
  const [showLogFullSize, setshowLogFullSize] = useState(false)

  return (
    <Modal
      open={modalTroubleShooting}
      fullPage
      onOpenChange={setModalTroubleShooting}
      title="Troubleshooting Assistance"
      content={
        <div className="flex h-full w-full flex-col overflow-hidden text-sm">
          <div className="mb-3 flex-shrink-0">
            <p className="text-[hsla(var(--text-secondary)] mt-2 pr-3 leading-relaxed">
              {`We're here to help! Your report is crucial for debugging and shaping
          the next version. Here’s how you can report & get further support:`}
            </p>
          </div>

          {!showLogFullSize && (
            <div className="mb-3 rounded-lg border border-[hsla(var(--app-border))] p-4 shadow">
              <h2 className="font-semibold">Step 1</h2>
              <p className="text-[hsla(var(--text-secondary)] mt-1">
                Follow our&nbsp;
                <a
                  href="https://jan.ai/guides/troubleshooting"
                  target="_blank"
                  className="text-[hsla(var(--app-link))] hover:underline"
                >
                  troubleshooting guide
                </a>
                &nbsp;for step-by-step solutions.
              </p>
            </div>
          )}

          <div
            className={twMerge(
              'rounded-lg border border-[hsla(var(--app-border))] pb-2 shadow',
              !showLogFullSize && 'pt-4'
            )}
          >
            {!showLogFullSize && (
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
                        className="text-[hsla(var(--app-link))] hover:underline"
                      >
                        Discord
                      </a>
                      &nbsp;& send it to #🆘|jan-help channel for further
                      support.
                    </p>
                  </li>
                </ul>
              </div>
            )}

            <div
              className={twMerge('relative flex h-full w-full flex-col pt-4')}
            >
              <div
                className={twMerge(
                  'border-y border-[hsla(var(--app-border))] px-4 py-2'
                )}
              >
                <ul className="inline-flex space-x-2 rounded-lg px-1">
                  {logOption.map((name, i) => {
                    return (
                      <li
                        className={twMerge(
                          'relative cursor-pointer px-4 py-2',
                          isTabActive === i &&
                            'rounded-md bg-[hsla(var(--primary-bg))] font-bold text-[hsla(var(--primary-fg))]'
                        )}
                        key={i}
                        onClick={() => setIsTabActivbe(i)}
                      >
                        <span
                          className={twMerge(
                            'text-[hsla(var(--text-secondary)] relative z-50 font-medium'
                          )}
                        >
                          {name}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
              <div
                className={twMerge(
                  'max-h-[180px] overflow-y-auto',
                  showLogFullSize && 'max-h-[400px]'
                )}
              >
                <Button
                  theme="icon"
                  className="absolute right-4 top-20"
                  autoFocus={false}
                  onClick={() => setshowLogFullSize(!showLogFullSize)}
                >
                  <Maximize2 size={14} />
                </Button>
                <div
                  className={twMerge('hidden', isTabActive === 0 && 'block')}
                >
                  <AppLogs />
                </div>
                <div
                  className={twMerge('hidden', isTabActive === 1 && 'block')}
                >
                  <CortexLogs />
                </div>
                <div
                  className={twMerge('hidden', isTabActive === 2 && 'block')}
                >
                  <ServerLogs limit={50} withCopy />
                </div>
                <div
                  className={twMerge('hidden', isTabActive === 3 && 'block')}
                >
                  <DeviceSpecs />
                </div>
              </div>
            </div>
          </div>
        </div>
      }
    />
  )
}

export default ModalTroubleShooting
