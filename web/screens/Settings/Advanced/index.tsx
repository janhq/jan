'use client'

import { useEffect, useState, useCallback, ChangeEvent } from 'react'

import { openExternalUrl, AppConfiguration } from '@janhq/core'

import {
  ScrollArea,
  Switch,
  Input,
  Tooltip,
  Checkbox,
  useClickOutside,
  Button,
} from '@janhq/joi'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { ChevronDownIcon } from 'lucide-react'
import { AlertTriangleIcon, AlertCircleIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { useDebouncedCallback } from 'use-debounce'

import { snackbar, toaster } from '@/containers/Toast'

import { useActiveModel } from '@/hooks/useActiveModel'
import { useConfigurations } from '@/hooks/useConfigurations'
import { useSettings } from '@/hooks/useSettings'

import ModalDeleteAllThreads from '@/screens/Thread/ThreadLeftPanel/ModalDeleteAllThreads'

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

import { ThreadModalAction } from '@/helpers/atoms/Thread.atom'

import { modalActionThreadAtom } from '@/helpers/atoms/Thread.atom'

type GPU = {
  id: string
  vram: number | null
  name: string
}

/**
 * Advanced Settings Screen
 * @returns
 */
const Advanced = () => {
  const [experimentalEnabled, setExperimentalEnabled] = useAtom(
    experimentalFeatureEnabledAtom
  )
  const [vulkanEnabled, setVulkanEnabled] = useAtom(vulkanEnabledAtom)
  const [proxyEnabled, setProxyEnabled] = useAtom(proxyEnabledAtom)
  const [quickAskEnabled, setQuickAskEnabled] = useAtom(quickAskEnabledAtom)

  const [proxy, setProxy] = useAtom(proxyAtom)
  const [ignoreSSL, setIgnoreSSL] = useAtom(ignoreSslAtom)

  const [partialProxy, setPartialProxy] = useState<string>(proxy)
  const [gpuEnabled, setGpuEnabled] = useState<boolean>(false)
  const [gpuList, setGpuList] = useState<GPU[]>([])
  const [gpusInUse, setGpusInUse] = useState<string[]>([])
  const [dropdownOptions, setDropdownOptions] = useState<HTMLDivElement | null>(
    null
  )
  const { configurePullOptions } = useConfigurations()

  const [toggle, setToggle] = useState<HTMLDivElement | null>(null)

  const { readSettings, saveSettings } = useSettings()
  const { stopModel } = useActiveModel()
  const [open, setOpen] = useState(false)
  const setModalActionThread = useSetAtom(modalActionThreadAtom)

  const selectedGpu = gpuList
    .filter((x) => gpusInUse.includes(x.id))
    .map((y) => {
      return y['name']
    })

  /**
   * There could be a case where the state update is not synced
   * so that retrieving state value from other hooks would not be accurate
   * there is also a case where state update persist everytime user type in the input
   */
  const updatePullOptions = useDebouncedCallback(
    () => configurePullOptions(),
    300
  )
  /**
   * Handle proxy change
   */
  const onProxyChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value || ''
      setPartialProxy(value)
      if (value.trim().startsWith('http')) {
        setProxy(value.trim())
      } else {
        setProxy('')
      }
      updatePullOptions()
    },
    [setPartialProxy, setProxy, updatePullOptions]
  )

  /**
   * Update Quick Ask Enabled
   * @param e
   * @param relaunch
   * @returns void
   */
  const updateQuickAskEnabled = async (
    e: boolean,
    relaunch: boolean = true
  ) => {
    setQuickAskEnabled(e)
    if (relaunch) window.core?.api?.relaunch()
  }

  /**
   * Update Vulkan Enabled
   * @param e
   * @param relaunch
   * @returns void
   */
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

  /**
   * Update Experimental Enabled
   * @param e
   * @returns
   */
  const updateExperimentalEnabled = async (
    e: ChangeEvent<HTMLInputElement>
  ) => {
    setExperimentalEnabled(e.target.checked)

    // If it checked, we don't need to do anything else
    // Otherwise have to reset other settings
    if (e.target.checked) return

    // It affects other settings, so we need to reset them
    const isRelaunch = quickAskEnabled || vulkanEnabled
    if (quickAskEnabled) await updateQuickAskEnabled(false, false)
    if (vulkanEnabled) await updateVulkanEnabled(false, false)
    if (isRelaunch) window.core?.api?.relaunch()
  }

  /**
   * useEffect to set GPU enabled if possible
   */
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

  /**
   * Handle GPU Change
   * @param gpuId
   * @returns
   */
  const handleGPUChange = async (gpuId: string) => {
    let updatedGpusInUse = [...gpusInUse]
    if (updatedGpusInUse.includes(gpuId)) {
      updatedGpusInUse = updatedGpusInUse.filter((id) => id !== gpuId)
      if (
        gpuEnabled &&
        updatedGpusInUse.length === 0 &&
        gpuId &&
        gpuId.trim()
      ) {
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
      if (gpuId && gpuId.trim()) updatedGpusInUse.push(gpuId)
    }
    setGpusInUse(updatedGpusInUse)
    await saveSettings({ gpusInUse: updatedGpusInUse.filter((e) => !!e) })
    // Reload window to apply changes
    // This will trigger engine servers to restart
    window.location.reload()
  }

  const gpuSelectionPlaceHolder =
    gpuList.length > 0 ? 'Select GPU' : "You don't have any compatible GPU"

  /**
   * Handle click outside
   */
  useClickOutside(() => setOpen(false), null, [dropdownOptions, toggle])

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
              New features that are still unstable and could affect app
              performance. Enable with caution.
            </p>
          </div>
          <Switch
            data-testid="experimental-switch"
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
                      className="cursor-pointer text-[var(--app-link)]"
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

              <div className="flex items-center">
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
                        if (e.target.checked !== gpuEnabled) {
                          stopModel().finally(() => {
                            setTimeout(() => {
                              window.location.reload()
                            }, 300)
                          })
                        }
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

            <div className="mt-2 flex w-full flex-col rounded-lg px-2 py-4">
              <label className="mb-2 mr-2 inline-block font-medium">
                Choose device(s)
              </label>
              <div className="relative w-full md:w-1/2" ref={setToggle}>
                <Input
                  value={selectedGpu.join() || ''}
                  className={twMerge(
                    'w-full cursor-pointer',
                    gpuList.length === 0 && 'pointer-events-none'
                  )}
                  readOnly
                  disabled={gpuList.length === 0}
                  placeholder={gpuSelectionPlaceHolder}
                  suffixIcon={
                    <ChevronDownIcon
                      size={14}
                      className={twMerge(
                        gpuList.length === 0 && 'pointer-events-none',
                        open && 'rotate-180'
                      )}
                    />
                  }
                  onClick={() => setOpen(!open)}
                />
                {gpuList.length > 0 && (
                  <div
                    className={twMerge(
                      'absolute right-0 top-0 z-20 mt-10 max-h-80 w-full overflow-hidden rounded-lg border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] shadow-sm',
                      open ? 'flex' : 'hidden'
                    )}
                    ref={setDropdownOptions}
                  >
                    <div className="w-full p-4">
                      <p>
                        {vulkanEnabled ? 'Vulkan Supported GPUs' : 'Nvidia'}
                      </p>
                      <div className="py-2">
                        <div className="rounded-lg">
                          {gpuList
                            .filter((gpu) =>
                              vulkanEnabled
                                ? gpu.name
                                : gpu.name?.toLowerCase().includes('nvidia')
                            )
                            .map((gpu) => (
                              <div
                                key={gpu.id}
                                className="mt-2 flex items-center space-x-2"
                              >
                                <Checkbox
                                  id={`gpu-${gpu.id}`}
                                  name="gpu-nvidia"
                                  value={gpu.id}
                                  checked={gpusInUse.includes(gpu.id)}
                                  onChange={() => handleGPUChange(gpu.id)}
                                  label={
                                    <span>
                                      <span>{gpu.name}</span>
                                      {!vulkanEnabled && (
                                        <span>{gpu.vram}MB VRAM</span>
                                      )}
                                    </span>
                                  }
                                />
                              </div>
                            ))}
                        </div>
                        {gpuEnabled && gpusInUse.length > 1 && (
                          <div className="mt-2 flex items-start space-x-2 text-[hsla(var(--warning-bg))]">
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
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Vulkan for AMD GPU/ APU and Intel Arc GPU */}
        {!isMac && experimentalEnabled && (
          <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
            <div className="space-y-1">
              <div className="flex gap-x-2">
                <h6 className="font-semibold capitalize">Vulkan Support</h6>
              </div>
              <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
                Enable Vulkan with AMD GPU/APU and Intel Arc GPU for better
                model performance (reload needed).
              </p>
            </div>
            <div className="flex-shrink-0">
              <Switch
                checked={vulkanEnabled}
                onChange={(e) => updateVulkanEnabled(e.target.checked)}
              />
            </div>
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
              Optional proxy server for internet connections. Only HTTPS proxies
              supported.
            </p>
          </div>

          <div className="flex w-full flex-shrink-0 flex-col items-end gap-2 pr-1 sm:w-1/2">
            <Switch
              data-testid="proxy-switch"
              checked={proxyEnabled}
              onChange={() => {
                setProxyEnabled(!proxyEnabled)
                updatePullOptions()
              }}
            />
            <div className="w-full">
              <Input
                data-testid="proxy-input"
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
            data-testid="ignore-ssl-switch"
            checked={ignoreSSL}
            onChange={(e) => {
              setIgnoreSSL(e.target.checked)
              updatePullOptions()
            }}
          />
        </div>

        {experimentalEnabled && (
          <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
            <div className="flex-shrink-0 space-y-1">
              <div className="flex gap-x-2">
                <h6 className="font-semibold capitalize">Jan Quick Ask</h6>
              </div>
              <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
                Enable Quick Ask to be triggered via the default hotkey .
                <span className="text-[hsla(var(--text-secondary)] bg-secondary inline-flex items-center justify-center rounded-full px-1 py-0.5 text-xs font-bold">
                  <span className="font-bold">{isMac ? '⌘' : 'Ctrl'} + J</span>
                </span>{' '}
                (reload needed).
              </p>
            </div>
            <Switch
              data-testid="quick-ask-switch"
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

        {/* Delete All Threads */}
        <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
          <div className="space-y-1">
            <div className="flex gap-x-2">
              <h6 className="font-semibold capitalize">Delete All Threads</h6>
            </div>
            <p className="whitespace-pre-wrap font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
              Delete all threads and associated chat history.
            </p>
          </div>
          <Button
            data-testid="delete-all-threads-button"
            theme="destructive"
            onClick={() => {
              setModalActionThread({
                showModal: ThreadModalAction.DeleteAll,
                thread: undefined,
              })
            }}
          >
            Delete All Threads
          </Button>
        </div>
        <ModalDeleteAllThreads />

        {/* Factory Reset */}
        <FactoryReset />
      </div>
    </ScrollArea>
  )
}

export default Advanced
