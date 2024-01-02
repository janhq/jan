/* eslint-disable react-hooks/exhaustive-deps */
'use client'

import { useContext, useEffect, useState } from 'react'

import {
  Switch,
  Button,
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
  Badge,
} from '@janhq/uikit'

import ShortCut from '@/containers/Shortcut'

import { FeatureToggleContext } from '@/context/FeatureToggle'

import { useSettings } from '@/hooks/useSettings'

const Advanced = () => {
  const { experimentalFeatureEnabed, setExperimentalFeatureEnabled } =
    useContext(FeatureToggleContext)
  const [gpuEnabled, setGpuEnabled] = useState<boolean>(false)
  const { readSettings, saveSettings, validateSettings, setShowNotification } =
    useSettings()

  useEffect(() => {
    readSettings().then((settings) => {
      setGpuEnabled(settings.run_mode === 'gpu')
    })
  }, [])

  return (
    <div className="block w-full">
      {/* CPU / GPU switching */}
      {!isMac && (
        <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-0 last:border-none">
          <div className="w-4/5 flex-shrink-0 space-y-1.5">
            <div className="flex gap-x-2">
              <h6 className="text-sm font-semibold capitalize">NVidia GPU</h6>
            </div>
            <p className="whitespace-pre-wrap leading-relaxed">
              Enable GPU acceleration for NVidia GPUs.
            </p>
          </div>
          <Switch
            checked={gpuEnabled}
            onCheckedChange={(e: boolean) => {
              if (e === true) {
                saveSettings({ runMode: 'gpu' })
                setGpuEnabled(true)
                setShowNotification(false)
                setTimeout(() => {
                  validateSettings()
                }, 300)
              } else {
                saveSettings({ runMode: 'cpu' })
                setGpuEnabled(false)
              }
            }}
          />
        </div>
      )}
      {/* Experimental */}
      <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-0 last:border-none">
        <div className="w-4/5 flex-shrink-0 space-y-1.5">
          <div className="flex gap-x-2">
            <h6 className="text-sm font-semibold capitalize">
              Experimental Mode
            </h6>
          </div>
          <p className="whitespace-pre-wrap leading-relaxed">
            Enable experimental features that may be unstable tested.
          </p>
        </div>
        <Switch
          checked={experimentalFeatureEnabed}
          onCheckedChange={(e) => {
            if (e === true) {
              setExperimentalFeatureEnabled(true)
            } else {
              setExperimentalFeatureEnabled(false)
            }
          }}
        />
      </div>
      {window.electronAPI && (
        <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-0 last:border-none">
          <div className="w-4/5 flex-shrink-0 space-y-1.5">
            <div className="flex gap-x-2">
              <h6 className="text-sm font-semibold capitalize">
                Open App Directory
              </h6>
            </div>
            <p className="whitespace-pre-wrap leading-relaxed">
              Open the directory where your app data, like conversation history
              and model configurations, is located.
            </p>
          </div>
          <Button
            size="sm"
            themes="secondary"
            onClick={() => window.electronAPI.openAppDirectory()}
          >
            Open
          </Button>
        </div>
      )}
      <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-0 last:border-none">
        <div className="w-4/5 flex-shrink-0 space-y-1.5">
          <div className="flex gap-x-2">
            <h6 className="text-sm font-semibold capitalize">
              Keyboard Shortcuts
            </h6>
          </div>
          <p className="whitespace-pre-wrap leading-relaxed">
            Shortcuts that you might find useful in Jan app.
          </p>
        </div>
        <Modal>
          <ModalTrigger>
            <Button size="sm" themes="secondary">
              Show
            </Button>
          </ModalTrigger>
          <ModalContent className="max-w-2xl">
            <ModalHeader>
              <ModalTitle>Keyboard Shortcuts</ModalTitle>
            </ModalHeader>
            <div className="my-2 flex flex-col items-center justify-center gap-2">
              <div className="flex w-full gap-4 border-b border-border pb-2">
                <div className="w-1/2">
                  <div className="py-2">
                    <h6>Combination</h6>
                  </div>
                </div>
                <div className="w-full">
                  <div className="py-2">
                    <h6>Description</h6>
                  </div>
                </div>
              </div>
              <div className="flex w-full gap-4 border-b border-border pb-2">
                <div className="w-1/2">
                  <div className="py-2">
                    <ShortCut menu="E" />
                  </div>
                </div>
                <div className="w-full">
                  <div className="py-2">
                    <p>Show list your models</p>
                  </div>
                </div>
              </div>
              <div className="flex w-full gap-4 border-b border-border pb-2">
                <div className="w-1/2">
                  <div className="py-2">
                    <ShortCut menu="K" />
                  </div>
                </div>
                <div className="w-full">
                  <div className="py-2">
                    <p>Show list navigation pages</p>
                  </div>
                </div>
              </div>
              <div className="flex w-full gap-4 border-b border-border pb-2">
                <div className="w-1/2">
                  <div className="py-2">
                    <ShortCut menu="," />
                  </div>
                </div>
                <div className="w-full">
                  <div className="py-2">
                    <p>Navigate to setting page</p>
                  </div>
                </div>
              </div>
              <div className="flex w-full gap-4 border-b border-border pb-2">
                <div className="w-1/2">
                  <div className="py-2">
                    <div className="inline-flex items-center justify-center rounded-full bg-secondary px-1 py-0.5 text-xs font-bold text-muted-foreground">
                      <p>Enter</p>
                    </div>
                  </div>
                </div>
                <div className="w-full">
                  <div className="py-2">
                    <p>Send a message</p>
                  </div>
                </div>
              </div>
              <div className="flex w-full gap-4 border-b border-border pb-2">
                <div className="w-1/2">
                  <div className="py-2">
                    <div className="inline-flex items-center justify-center rounded-full bg-secondary px-1 py-0.5 text-xs font-bold text-muted-foreground">
                      <p>Shift + Enter</p>
                    </div>
                  </div>
                </div>
                <div className="w-full">
                  <div className="py-2">
                    <p>Insert new line in input box</p>
                  </div>
                </div>
              </div>
              <div className="flex w-full gap-4 border-b border-border pb-2">
                <div className="w-1/2">
                  <div className="py-2">
                    <div className="inline-flex items-center justify-center rounded-full bg-secondary px-1 py-0.5 text-xs font-bold text-muted-foreground">
                      <p>Arrow Up</p>
                    </div>
                  </div>
                </div>
                <div className="w-full">
                  <div className="py-2">
                    <p>Navigate to previous option (within search dialog)</p>
                  </div>
                </div>
              </div>
              <div className="flex w-full gap-4 pb-2">
                <div className="w-1/2">
                  <div className="py-2">
                    <div className="inline-flex items-center justify-center rounded-full bg-secondary px-1 py-0.5 text-xs font-bold text-muted-foreground">
                      <p>Arrow Down</p>
                    </div>
                  </div>
                </div>
                <div className="w-full">
                  <div className="py-2">
                    <p>Navigate to next option (within search dialog)</p>
                  </div>
                </div>
              </div>
            </div>
          </ModalContent>
        </Modal>
      </div>
    </div>
  )
}

export default Advanced
