'use client'

import { useEffect, useState, useCallback, ChangeEvent } from 'react'

import { openExternalUrl, fs, AppConfiguration } from '@janhq/core'

import {
  ScrollArea,
  Button,
  Switch,
  Input,
  Tooltip,
  Checkbox,
  Select,
} from '@janhq/joi'

import { useAtom, useAtomValue } from 'jotai'
import { AlertTriangleIcon, AlertCircleIcon } from 'lucide-react'

import { snackbar, toaster } from '@/containers/Toast'

import { useActiveModel } from '@/hooks/useActiveModel'
import { useSettings } from '@/hooks/useSettings'

import DataFolder from './DataFolder'
import FactoryReset from './FactoryReset'

import {
  experimentalFeatureEnabledAtom,
  ignoreSslAtom,
  proxyAtom,
  proxyEnabledAtom,
  vulkanEnabledAtom,
  quickAskEnabledAtom,
} from '@/helpers/atoms/AppConfig.atom'

type GPU = {
  id: string
  vram: number | null
  name: string
}

const Advanced = () => {
  const [experimentalEnabled, setExperimentalEnabled] = useAtom(
    experimentalFeatureEnabledAtom
  )
  const [vulkanEnabled, setVulkanEnabled] = useAtom(vulkanEnabledAtom)
  const [proxyEnabled, setProxyEnabled] = useAtom(proxyEnabledAtom)
  const quickAskEnabled = useAtomValue(quickAskEnabledAtom)

  const [proxy, setProxy] = useAtom(proxyAtom)
  const [ignoreSSL, setIgnoreSSL] = useAtom(ignoreSslAtom)

  const [partialProxy, setPartialProxy] = useState<string>(proxy)
  const [gpuEnabled, setGpuEnabled] = useState<boolean>(false)
  const [gpuList, setGpuList] = useState<GPU[]>([])
  const [gpusInUse, setGpusInUse] = useState<string[]>([])

  const { readSettings, saveSettings } = useSettings()
  const { stopModel } = useActiveModel()

  const selectedGpu = gpuList
    .filter((x) => gpusInUse.includes(x.id))
    .map((y) => {
      return y['name']
    })

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

  const updateQuickAskEnabled = async (
    e: boolean,
    relaunch: boolean = true
  ) => {
    const appConfiguration: AppConfiguration =
      await window.core?.api?.getAppConfigurations()
    appConfiguration.quick_ask = e
    await window.core?.api?.updateAppConfiguration(appConfiguration)
    if (relaunch) window.core?.api?.relaunch()
  }

  const updateVulkanEnabled = async (e: boolean, relaunch: boolean = true) => {
    toaster({
      title: 'Reload',
      description: 'Vulkan settings updated. Reload now to apply the changes.',
    })
    stopModel()
    setVulkanEnabled(e)
    await saveSettings({ vulkan: e, gpusInUse: [] })
    // Relaunch to apply settings
    if (relaunch) window.location.reload()
  }

  const updateExperimentalEnabled = async (
    e: ChangeEvent<HTMLInputElement>
  ) => {
    setExperimentalEnabled(e.target.checked)
    if (e) return

    // It affects other settings, so we need to reset them
    const isRelaunch = quickAskEnabled || vulkanEnabled
    if (quickAskEnabled) await updateQuickAskEnabled(false, false)
    if (vulkanEnabled) await updateVulkanEnabled(false, false)
    if (isRelaunch) window.core?.api?.relaunch()
  }

  useEffect(() => {
    const setUseGpuIfPossible = async () => {
      const settings = await readSettings()
      setGpuEnabled(settings.run_mode === 'gpu' && settings.gpus?.length > 0)
      setGpusInUse(settings.gpus_in_use || [])
      setVulkanEnabled(settings.vulkan || false)
      if (settings.gpus) {
        setGpuList(settings.gpus)
      }
    }
    setUseGpuIfPossible()
  }, [readSettings, setGpuList, setGpuEnabled, setGpusInUse, setVulkanEnabled])

  const clearLogs = async () => {
    try {
      await fs.rm(`file://logs`)
    } catch (err) {
      console.error('Error clearing logs: ', err)
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
        // Vulkan support only allow 1 active device at a time
        if (vulkanEnabled) {
          updatedGpusInUse = []
        }
        updatedGpusInUse.push(gpuId)
      }
    } else {
      // Vulkan support only allow 1 active device at a time
      if (vulkanEnabled) {
        updatedGpusInUse = []
      }
      updatedGpusInUse.push(gpuId)
    }
    setGpusInUse(updatedGpusInUse)
    saveSettings({ gpusInUse: updatedGpusInUse })
  }

  const gpuSelectionPlaceHolder =
    gpuList.length > 0 ? 'Select GPU' : "You don't have any compatible GPU"

  return (
    <ScrollArea className="h-full w-full px-4">
      <div className="block w-full py-4">
        {/* Experimental */}
        <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
          <div className="flex-shrink-0 space-y-1">
            <div className="flex gap-x-2">
              <h6 className="font-semibold capitalize">Experimental Mode</h6>
            </div>
            <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
              Enable experimental features that may be untested and unstable.
            </p>
          </div>
          <Switch
            checked={experimentalEnabled}
            onChange={updateExperimentalEnabled}
          />
        </div>

        {/* CPU / GPU switching */}
        {!isMac && (
          <div className="flex w-full flex-col items-start justify-between border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none">
            <div className="flex w-full items-start justify-between">
              <div className="space-y-1">
                <div className="flex gap-x-2">
                  <h6 className="font-semibold capitalize">GPU Acceleration</h6>
                </div>
                <p className="pr-8 leading-relaxed">
                  Enable to enhance model performance by utilizing your GPU
                  devices for acceleration. Read{' '}
                  <span>
                    {' '}
                    <span
                      className="cursor-pointer text-blue-600"
                      onClick={() =>
                        openExternalUrl(
                          'https://jan.ai/guides/troubleshooting/gpu-not-used/'
                        )
                      }
                    >
                      troubleshooting guide
                    </span>{' '}
                  </span>{' '}
                  for further assistance.
                </p>
              </div>

              <div>
                {gpuList.length > 0 && !gpuEnabled && (
                  <Tooltip
                    trigger={
                      <AlertCircleIcon
                        size={16}
                        className="mr-2 text-[hsla(var(--warning-bg))]"
                      />
                    }
                    content="Disabling NVIDIA GPU Acceleration may result in reduced
                    performance. It is recommended to keep this enabled for
                    optimal user experience."
                  />
                )}
                <Tooltip
                  trigger={
                    <Switch
                      disabled={gpuList.length === 0 || vulkanEnabled}
                      checked={gpuEnabled}
                      onChange={(e) => {
                        if (e.target.checked === true) {
                          saveSettings({ runMode: 'gpu' })
                          setGpuEnabled(true)
                          snackbar({
                            description:
                              'Successfully turned on GPU Acceleration',
                            type: 'success',
                          })
                        } else {
                          saveSettings({ runMode: 'cpu' })
                          setGpuEnabled(false)
                          snackbar({
                            description:
                              'Successfully turned off GPU Acceleration',
                            type: 'success',
                          })
                        }
                        // Stop any running model to apply the changes
                        if (e.target.checked !== gpuEnabled) stopModel()
                      }}
                    />
                  }
                  content="Your current device does not have a compatible GPU for
                  monitoring. To enable GPU monitoring, please ensure your
                  device has a supported Nvidia or AMD GPU with updated
                  drivers."
                  disabled={gpuList.length > 0}
                />
              </div>
            </div>
            <div className="bg-secondary mt-2 w-full rounded-lg p-4">
              <label className="mb-1 mr-2 inline-block font-medium">
                Choose device(s)
              </label>
              {/* TODO @Faisal fix this */}
              {/* <Select
                disabled={gpuList.length === 0 || !gpuEnabled}
                value={selectedGpu.join()}
                placeholder=''
              >
                <SelectTrigger className="w-[340px] bg-white dark:bg-gray-500">
                  <SelectValue placeholder={gpuSelectionPlaceHolder}>
                    <span className="line-clamp-1 w-full pr-8">
                      {selectedGpu.join()}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectContent className="w-[400px] px-1 pb-2">
                    <SelectGroup>
                      <SelectLabel>
                        {vulkanEnabled ? 'Vulkan Supported GPUs' : 'Nvidia'}
                      </SelectLabel>
                      <div className="px-4 pb-2">
                        <div className="rounded-lg bg-secondary p-3">
                          {gpuList
                            .filter((gpu) =>
                              vulkanEnabled
                                ? gpu.name
                                : gpu.name?.toLowerCase().includes('nvidia')
                            )
                            .map((gpu) => (
                              <div
                                key={gpu.id}
                                className="my-1 flex items-center space-x-2"
                              >
                                <Checkbox
                                  id={`gpu-${gpu.id}`}
                                  name="gpu-nvidia"
                                  className="bg-white"
                                  value={gpu.id}
                                  checked={gpusInUse.includes(gpu.id)}
                                  onChange={() => handleGPUChange(gpu.id)}
                                />
                                <label
                                  className="flex w-full items-center justify-between"
                                  htmlFor={`gpu-${gpu.id}`}
                                >
                                  <span>{gpu.name}</span>
                                  {!vulkanEnabled && (
                                    <span>{gpu.vram}MB VRAM</span>
                                  )}
                                </label>
                              </div>
                            ))}
                        </div>
                        {gpuEnabled && gpusInUse.length > 1 && (
                          <div className="mt-2 flex items-start space-x-2 text-yellow-500">
                            <AlertTriangleIcon
                              size={16}
                              className="flex-shrink-0"
                            />
                            <p className="text-xs leading-relaxed">
                              If multi-GPU is enabled with different GPU models
                              or without NVLink, it could impact token speed.
                            </p>
                          </div>
                        )}
                      </div>
                    </SelectGroup>
                  </SelectContent>
                </SelectPortal>
              </Select> */}
            </div>
          </div>
        )}

        {/* Vulkan for AMD GPU/ APU and Intel Arc GPU */}
        {!isMac && experimentalEnabled && (
          <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
            <div className="flex-shrink-0 space-y-1">
              <div className="flex gap-x-2">
                <h6 className="font-semibold capitalize">Vulkan Support</h6>
              </div>
              <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
                Enable Vulkan with AMD GPU/APU and Intel Arc GPU for better
                model performance (reload needed).
              </p>
            </div>

            <Switch
              checked={vulkanEnabled}
              onChange={(e) => updateVulkanEnabled(e.target.checked)}
            />
          </div>
        )}

        <DataFolder />

        {/* Proxy */}
        <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
          <div className="w-full space-y-1">
            <div className="flex w-full justify-between gap-x-2">
              <h6 className="font-semibold capitalize">HTTPS Proxy</h6>
            </div>
            <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
              Specify the HTTPS proxy or leave blank (proxy auto-configuration
              and SOCKS not supported).
            </p>
          </div>

          <div className="flex w-full flex-shrink-0 flex-col items-end gap-2 pr-1 sm:w-1/2">
            <Switch
              checked={proxyEnabled}
              onChange={() => setProxyEnabled(!proxyEnabled)}
            />
            <div className="w-full">
              <Input
                placeholder={'http://<user>:<password>@<domain or IP>:<port>'}
                value={partialProxy}
                onChange={onProxyChange}
              />
            </div>
          </div>
        </div>

        {/* Ignore SSL certificates */}
        <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
          <div className="flex-shrink-0 space-y-1">
            <div className="flex gap-x-2">
              <h6 className="font-semibold capitalize">
                Ignore SSL certificates
              </h6>
            </div>
            <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
              Allow self-signed or unverified certificates - may be required for
              certain proxies.
            </p>
          </div>
          <Switch
            checked={ignoreSSL}
            onChange={(e) => setIgnoreSSL(e.target.checked)}
          />
        </div>

        {experimentalEnabled && (
          <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
            <div className="flex-shrink-0 space-y-1">
              <div className="flex gap-x-2">
                <h6 className="font-semibold capitalize">Jan Quick Ask</h6>
              </div>
              <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
                Enable Quick Ask to be triggered via the default hotkey{' '}
                <div className="text-[hsla(var(--text-secondary)] bg-secondary inline-flex items-center justify-center rounded-full px-1 py-0.5 text-xs font-bold">
                  <span className="font-bold">{isMac ? '⌘' : 'Ctrl'} + J</span>
                </div>{' '}
                (reload needed).
              </p>
            </div>
            <Switch
              checked={quickAskEnabled}
              onChange={() => {
                toaster({
                  title: 'Reload',
                  description:
                    'Quick Ask settings updated. Reload now to apply the changes.',
                })
                updateQuickAskEnabled(!quickAskEnabled)
              }}
            />
          </div>
        )}

        {/* Clear log */}
        <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
          <div className="flex-shrink-0 space-y-1">
            <div className="flex gap-x-2">
              <h6 className="font-semibold capitalize">Clear logs</h6>
            </div>
            <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
              Clear all logs from Jan app.
            </p>
          </div>
          <Button
            size="small"
            theme="destructive"
            variant="soft"
            onClick={clearLogs}
          >
            Clear
          </Button>
        </div>

        {/* Factory Reset */}
        <FactoryReset />
      </div>
    </ScrollArea>
  )
}

export default Advanced
