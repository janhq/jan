/* eslint-disable react-hooks/exhaustive-deps */
'use client'

import {
  useContext,
  useEffect,
  useState,
  useCallback,
  ChangeEvent,
} from 'react'

import { fs } from '@janhq/core'
import { Switch, Button, Input } from '@janhq/uikit'

import ShortcutModal from '@/containers/ShortcutModal'

import { toaster } from '@/containers/Toast'

import { FeatureToggleContext } from '@/context/FeatureToggle'

import { useSettings } from '@/hooks/useSettings'

import DataFolder from './DataFolder'

const Advanced = () => {
  const {
    experimentalFeature,
    setExperimentalFeature,
    ignoreSSL,
    setIgnoreSSL,
    proxy,
    setProxy,
  } = useContext(FeatureToggleContext)
  const [partialProxy, setPartialProxy] = useState<string>(proxy)
  const [gpuEnabled, setGpuEnabled] = useState<boolean>(false)

  const { readSettings, saveSettings, validateSettings, setShowNotification } =
    useSettings()
  const onProxyChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value || ''
      setPartialProxy(value)
      if (value.trim().startsWith('http')) {
        setProxy(value.trim())
      } else {
        setProxy('')
      }
    },
    [setPartialProxy, setProxy]
  )

  useEffect(() => {
    readSettings().then((settings) => {
      setGpuEnabled(settings.run_mode === 'gpu')
    })
  }, [])

  const clearLogs = async () => {
    if (await fs.existsSync(`file://logs`)) {
      await fs.rmdirSync(`file://logs`, { recursive: true })
    }
    toaster({
      title: 'Logs cleared',
      description: 'All logs have been cleared.',
      type: 'success',
    })
  }

  return (
    <div className="block w-full">
      {/* Keyboard shortcut  */}
      <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-0 last:border-none">
        <div className="flex-shrink-0 space-y-1.5">
          <div className="flex gap-x-2">
            <h6 className="text-sm font-semibold capitalize">
              Keyboard Shortcuts
            </h6>
          </div>
          <p className="leading-relaxed">
            Shortcuts that you might find useful in Jan app.
          </p>
        </div>
        <ShortcutModal />
      </div>

      {/* Experimental */}
      <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-0 last:border-none">
        <div className="flex-shrink-0 space-y-1.5">
          <div className="flex gap-x-2">
            <h6 className="text-sm font-semibold capitalize">
              Experimental Mode
            </h6>
          </div>
          <p className="leading-relaxed">
            Enable experimental features that may be unstable tested.
          </p>
        </div>
        <Switch
          checked={experimentalFeature}
          onCheckedChange={(e) => {
            if (e === true) {
              setExperimentalFeature(true)
            } else {
              setExperimentalFeature(false)
            }
          }}
        />
      </div>

      {/* CPU / GPU switching */}
      {!isMac && (
        <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-0 last:border-none">
          <div className="flex-shrink-0 space-y-1.5">
            <div className="flex gap-x-2">
              <h6 className="text-sm font-semibold capitalize">NVidia GPU</h6>
            </div>
            <p className="leading-relaxed">
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

      {/* Directory */}
      <DataFolder />

      {/* Proxy */}
      <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-0 last:border-none">
        <div className="flex-shrink-0 space-y-1.5">
          <div className="flex gap-x-2">
            <h6 className="text-sm font-semibold capitalize">HTTPS Proxy</h6>
          </div>
          <p className="leading-relaxed">
            Specify the HTTPS proxy or leave blank (proxy auto-configuration and
            SOCKS not supported).
          </p>
          <Input
            placeholder={'http://<user>:<password>@<domain or IP>:<port>'}
            value={partialProxy}
            onChange={onProxyChange}
          />
        </div>
      </div>

      {/* Ignore SSL certificates */}
      <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-0 last:border-none">
        <div className="flex-shrink-0 space-y-1.5">
          <div className="flex gap-x-2">
            <h6 className="text-sm font-semibold capitalize">
              Ignore SSL certificates
            </h6>
          </div>
          <p className="leading-relaxed">
            Allow self-signed or unverified certificates - may be required for
            certain proxies.
          </p>
        </div>
        <Switch
          checked={ignoreSSL}
          onCheckedChange={(e) => {
            if (e === true) {
              setIgnoreSSL(true)
            } else {
              setIgnoreSSL(false)
            }
          }}
        />
      </div>

      {/* Open app directory */}
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
            themes="secondaryBlue"
            onClick={() => window.core?.api?.openAppDirectory()}
          >
            Open
          </Button>
        </div>
      )}

      {/* Claer log */}
      <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-0 last:border-none">
        <div className="flex-shrink-0 space-y-1.5">
          <div className="flex gap-x-2">
            <h6 className="text-sm font-semibold capitalize">Clear logs</h6>
          </div>
          <p className="leading-relaxed">Clear all logs from Jan app.</p>
        </div>
        <Button size="sm" themes="secondaryDanger" onClick={clearLogs}>
          Clear
        </Button>
      </div>
    </div>
  )
}

export default Advanced
