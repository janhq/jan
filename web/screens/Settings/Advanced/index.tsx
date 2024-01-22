/* eslint-disable react-hooks/exhaustive-deps */
'use client'

import {
  useContext,
  useEffect,
  useState,
  useCallback,
  ChangeEvent,
} from 'react'

import { fs, AppConfiguration } from '@janhq/core'
import { Switch, Button, Input } from '@janhq/uikit'

import ShortcutModal from '@/containers/ShortcutModal'

import { toaster } from '@/containers/Toast'

import { FeatureToggleContext } from '@/context/FeatureToggle'

import { useSettings } from '@/hooks/useSettings'

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

  // TODO: remove me later.
  const [currentPath, setCurrentPath] = useState('')

  useEffect(() => {
    window.core?.api
      ?.getAppConfigurations()
      ?.then((appConfig: AppConfiguration) => {
        setCurrentPath(appConfig.data_folder)
      })
  }, [])

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
    })
  }

  const onJanVaultDirectoryClick = async () => {
    const destFolder = await window.core?.api?.selectDirectory()
    if (destFolder) {
      console.debug(`Destination folder selected: ${destFolder}`)

      try {
        const appConfiguration: AppConfiguration =
          await window.core?.api?.getAppConfigurations()
        const currentJanDataFolder = appConfiguration.data_folder
        if (currentJanDataFolder === destFolder) {
          console.debug(
            `Destination folder is the same as current folder. Ignore..`
          )
          return
        }
        appConfiguration.data_folder = destFolder

        await fs.syncFile(currentJanDataFolder, destFolder)
        await window.core?.api?.updateAppConfiguration(appConfiguration)
        console.debug(
          `File sync finished from ${currentJanDataFolder} to ${destFolder}`
        )
        await window.core?.api?.relaunch()
      } catch (e) {
        console.error(`Error: ${e}`)
      }
    }
  }

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
      {/* Proxy */}
      <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-0 last:border-none">
        <div className="w-4/5 flex-shrink-0 space-y-1.5">
          <div className="flex gap-x-2">
            <h6 className="text-sm font-semibold capitalize">HTTPS Proxy</h6>
          </div>
          <p className="whitespace-pre-wrap leading-relaxed">
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
        <div className="w-4/5 flex-shrink-0 space-y-1.5">
          <div className="flex gap-x-2">
            <h6 className="text-sm font-semibold capitalize">
              Ignore SSL certificates
            </h6>
          </div>
          <p className="whitespace-pre-wrap leading-relaxed">
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
            <h6 className="text-sm font-semibold capitalize">Clear logs</h6>
          </div>
          <p className="whitespace-pre-wrap leading-relaxed">
            Clear all logs from Jan app.
          </p>
        </div>
        <Button size="sm" themes="secondary" onClick={clearLogs}>
          Clear
        </Button>
      </div>
      {experimentalFeature && (
        <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-0 last:border-none">
          <div className="w-4/5 flex-shrink-0 space-y-1.5">
            <div className="flex gap-x-2">
              <h6 className="text-sm font-semibold capitalize">
                Jan Data Folder
              </h6>
            </div>
            <p className="whitespace-pre-wrap leading-relaxed">
              Where messages, model configurations, and other user data is
              placed.
            </p>
            <p className="whitespace-pre-wrap leading-relaxed text-gray-500">
              {`${currentPath}`}
            </p>
          </div>
          <Button
            size="sm"
            themes="secondary"
            onClick={onJanVaultDirectoryClick}
          >
            Select
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
        <ShortcutModal />
      </div>
    </div>
  )
}

export default Advanced
