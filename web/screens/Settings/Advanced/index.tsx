'use client'

import { useContext, useEffect, useState } from 'react'

import { Switch, Button } from '@janhq/uikit'

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
    </div>
  )
}

export default Advanced
