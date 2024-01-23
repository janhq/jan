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
import FactoryReset from './FactoryReset'

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
  const [gpuList, setGpuList] = useState([
    { id: 'none', vram: null, name: 'none' },
  ])
  const [gpusInUse, setGpusInUse] = useState<string[]>([])
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
    const setUseGpuIfPossible = async () => {
      const settings = await readSettings()
      setGpuEnabled(settings.run_mode === 'gpu')
      setGpusInUse(settings.gpus_in_use || [])
      if (settings.gpus) {
        setGpuList(settings.gpus)
      }
      setUseGpuIfPossible()
    }
  }, [readSettings])

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

  const handleGPUChange = (gpuId: string) => {
    let updatedGpusInUse = [...gpusInUse]
    if (updatedGpusInUse.includes(gpuId)) {
      updatedGpusInUse = updatedGpusInUse.filter((id) => id !== gpuId)
      if (gpuEnabled && updatedGpusInUse.length === 0) {
        updatedGpusInUse.push(gpuId)
      }
    } else {
      updatedGpusInUse.push(gpuId)
    }
    setGpusInUse(updatedGpusInUse)
    saveSettings({ gpusInUse: updatedGpusInUse })
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
          onCheckedChange={setExperimentalFeature}
        />
      </div>

      {/* CPU / GPU switching */}
      {!isMac && (
        <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-0 last:border-none">
          <div className="flex-shrink-0 space-y-1.5">
            <div className="flex gap-x-2">
              <h6 className="text-sm font-semibold capitalize">Nvidia GPU</h6>
            </div>
            <p className="leading-relaxed">
              Enable GPU acceleration for Nvidia GPUs.
            </p>
          </div>
          <Switch
            checked={gpuEnabled}
            onCheckedChange={(e) => {
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
      {gpuEnabled && (
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700">
            Select GPU(s)
          </label>
          <div className="mt-2 space-y-2">
            {gpuList.map((gpu) => (
              <div key={gpu.id}>
                <input
                  type="checkbox"
                  id={`gpu-${gpu.id}`}
                  name="gpu"
                  value={gpu.id}
                  checked={gpusInUse.includes(gpu.id)}
                  onChange={() => handleGPUChange(gpu.id)}
                />
                <label htmlFor={`gpu-${gpu.id}`}>
                  {' '}
                  {gpu.name} (VRAM: {gpu.vram} MB)
                </label>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Warning message */}
      {gpuEnabled && gpusInUse.length > 1 && (
        <p className="mt-2 italic text-red-500">
          If enabling multi-GPU without the same GPU model or without NVLink, it
          may affect token speed.
        </p>
      )}
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
        <Switch checked={ignoreSSL} onCheckedChange={(e) => setIgnoreSSL(e)} />
      </div>

      {/* Clear log */}
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

      {/* Factory Reset */}
      <FactoryReset />
    </div>
  )
}

export default Advanced
