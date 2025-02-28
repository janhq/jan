'use client'

import { ChangeEvent } from 'react'

import { AppConfiguration } from '@janhq/core'

import { ScrollArea, Switch, Button } from '@janhq/joi'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { ArrowRightIcon } from 'lucide-react'

import { useDebouncedCallback } from 'use-debounce'

import { toaster } from '@/containers/Toast'

import { useApp } from '@/hooks/useApp'
import { useConfigurations } from '@/hooks/useConfigurations'

import ModalDeleteAllThreads from '@/screens/Thread/ThreadLeftPanel/ModalDeleteAllThreads'

import DataFolder from './DataFolder'
import FactoryReset from './FactoryReset'

import {
  experimentalFeatureEnabledAtom,
  proxyEnabledAtom,
  quickAskEnabledAtom,
} from '@/helpers/atoms/AppConfig.atom'

import { showScrollBarAtom } from '@/helpers/atoms/Setting.atom'
import { ThreadModalAction } from '@/helpers/atoms/Thread.atom'

import { modalActionThreadAtom } from '@/helpers/atoms/Thread.atom'

/**
 * Advanced Settings Screen
 * @returns
 */
const Advanced = ({ setSubdir }: { setSubdir: (subdir: string) => void }) => {
  const [experimentalEnabled, setExperimentalEnabled] = useAtom(
    experimentalFeatureEnabledAtom
  )
  const showScrollBar = useAtomValue(showScrollBarAtom)

  const [proxyEnabled, setProxyEnabled] = useAtom(proxyEnabledAtom)
  const quickAskEnabled = useAtomValue(quickAskEnabledAtom)

  const { configurePullOptions } = useConfigurations()

  const setModalActionThread = useSetAtom(modalActionThreadAtom)
  const { relaunch } = useApp()

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
   * Update Quick Ask Enabled
   * @param e
   * @param relaunch
   * @returns void
   */
  const updateQuickAskEnabled = async (
    e: boolean,
    relaunchApp: boolean = true
  ) => {
    const appConfiguration: AppConfiguration =
      await window.core?.api?.getAppConfigurations()
    appConfiguration.quick_ask = e
    await window.core?.api?.updateAppConfiguration(appConfiguration)
    if (relaunchApp) relaunch()
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
    const isRelaunch = quickAskEnabled
    if (quickAskEnabled) await updateQuickAskEnabled(false, false)
    if (isRelaunch) relaunch()
  }

  return (
    <ScrollArea
      type={showScrollBar ? 'always' : 'scroll'}
      className="h-full w-full px-4"
    >
      <div className="block w-full py-4">
        {/* Experimental */}
        <div className="flex w-full flex-row items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none">
          <div className="space-y-1">
            <div className="flex gap-x-2">
              <h6 className="font-semibold capitalize">Experimental Mode</h6>
            </div>
            <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
              New features that are still unstable and could affect app
              performance. Enable with caution.
            </p>
          </div>
          <div className="flex-shrink-0">
            <Switch
              data-testid="experimental-switch"
              checked={experimentalEnabled}
              onChange={updateExperimentalEnabled}
            />
          </div>
        </div>

        <DataFolder />

        {/* Proxy Settings Link */}
        <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
          <div className="flex w-full cursor-pointer items-start justify-between">
            <div className="space-y-1">
              <div className="flex gap-x-2">
                <h6 className="font-semibold capitalize">HTTPS Proxy</h6>
              </div>
              <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
                Optional proxy server for internet connections.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                data-testid="proxy-switch"
                checked={proxyEnabled}
                onClick={(e) => {
                  e.stopPropagation()
                  setProxyEnabled(!proxyEnabled)
                  updatePullOptions()
                }}
              />
              <ArrowRightIcon size={16} onClick={() => setSubdir('proxy')} />
            </div>
          </div>
        </div>

        {experimentalEnabled && (
          <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
            <div className="flex-shrink-0 space-y-1">
              <div className="flex gap-x-2">
                <h6 className="font-semibold capitalize">Jan Quick Ask</h6>
              </div>
              <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
                Enable Quick Ask to be triggered via the default hotkey
                <span className="text-[hsla(var(--text-secondary)] bg-secondary inline-flex items-center justify-center rounded-full px-1 py-0.5 text-xs font-bold">
                  <span className="font-bold">{isMac ? '⌘' : 'Ctrl'} + J</span>
                </span>{' '}
                .
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
