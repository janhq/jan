'use client'
import React, { Fragment } from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  ChartPieIcon,
  CommandLineIcon,
  PlayIcon,
} from '@heroicons/react/24/outline'

import { motion as m } from 'framer-motion'

import AppearanceOptions from './Appearance'
import PluginCatalog from './CorePlugins/PluginsCatalog'
import PreferencePlugins from './CorePlugins/PreferencePlugins'

import { MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import classNames from 'classnames'
import { PluginService, preferences } from '@janhq/core'
import { execute } from '../../../electron/core/plugin-manager/execution/extension-manager'
import { twMerge } from 'tailwind-merge'
// import LoadingIndicator from './LoadingIndicator'

import { formatPluginsName } from '@utils/converter'

import {
  plugins,
  extensionPoints,
} from '@/../../electron/core/plugin-manager/execution/index'

const staticMenu = ['Appearance', 'Core Plugins']

const SettingsScreen = () => {
  const [activeStaticMenu, setActiveStaticMenu] = useState('Appearance')
  const [preferenceItems, setPreferenceItems] = useState<any[]>([])
  const [preferenceValues, setPreferenceValues] = useState<any[]>([])

  /**
   * Fetches the active plugins and their preferences from the `plugins` and `preferences` modules.
   * If the `experimentComponent` extension point is available, it executes the extension point and
   * appends the returned components to the `experimentRef` element.
   * If the `PluginPreferences` extension point is available, it executes the extension point and
   * fetches the preferences for each plugin using the `preferences.get` function.
   */
  useEffect(() => {
    const getActivePluginPreferences = async () => {
      if (extensionPoints.get('PluginPreferences')) {
        const data = await Promise.all(
          extensionPoints.execute('PluginPreferences')
        )
        setPreferenceItems(Array.isArray(data) ? data : [])
        Promise.all(
          (Array.isArray(data) ? data : []).map((e) =>
            preferences
              .get(e.pluginName, e.preferenceKey)
              .then((k) => ({ key: e.preferenceKey, value: k }))
          )
        ).then((data) => {
          setPreferenceValues(data)
        })
      }
    }
    getActivePluginPreferences()
  }, [])

  const preferencePlugins = preferenceItems
    .map((x) => x.pluginName)
    .filter((x, i) => {
      return preferenceItems.map((x) => x.pluginName).indexOf(x) === i
    })

  /**
   * Notifies plugins of a preference update by executing the `PluginService.OnPreferencesUpdate` event.
   * If a timeout is already set, it is cleared before setting a new timeout to execute the event.
   */
  let timeout: any | undefined = undefined
  function notifyPreferenceUpdate() {
    if (timeout) {
      clearTimeout(timeout)
    }
    timeout = setTimeout(() => execute(PluginService.OnPreferencesUpdate), 100)
  }

  const [activePreferencePlugin, setActivePreferencePlugin] = useState(
    preferencePlugins[0]
  )

  const handleShowOptions = (menu: string) => {
    switch (menu) {
      case 'Core Plugins':
        return <PluginCatalog />

      case 'Appearance':
        return <AppearanceOptions />

      default:
        return <PreferencePlugins pluginName={menu} />
    }
  }

  return (
    <div className="flex h-full">
      <div className="border-gray-20 flex h-full w-80 flex-shrink-0 flex-col overflow-y-scroll border-r bg-white/20 dark:border-gray-900 dark:bg-black/20">
        <div className="p-6">
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Manage your account settings
          </p>
          <div className="mt-5 flex-shrink-0">
            <label className="font-bold uppercase text-gray-500">Options</label>
            <div className="mt-1 font-semibold">
              {staticMenu.map((menu, i) => {
                const isActive = activeStaticMenu === menu
                return (
                  <div key={i} className="relative block py-2">
                    <button
                      onClick={() => {
                        setActiveStaticMenu(menu)
                        setActivePreferencePlugin('')
                      }}
                      className="block w-full text-left"
                    >
                      <p className={twMerge(isActive && 'relative z-10')}>
                        {menu}
                      </p>
                    </button>
                    {isActive ? (
                      <m.div
                        className="absolute inset-0 -left-4 h-full w-[calc(100%+32px)] rounded-md bg-blue-300/50 p-2 dark:bg-gray-800/30"
                        layoutId="active-static-menu"
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="mt-5 flex-shrink-0">
            <label className="font-bold uppercase text-gray-500">
              Core plugins
            </label>
            <div className="mt-1 font-semibold">
              {preferencePlugins.map((menu, i) => {
                const isActive = activePreferencePlugin === menu
                return (
                  <div key={i} className="relative block py-2">
                    <button
                      onClick={() => {
                        setActivePreferencePlugin(menu)
                        setActiveStaticMenu('')
                      }}
                      className="block w-full text-left"
                    >
                      <p
                        className={twMerge(
                          'capitalize',
                          isActive && 'relative z-10'
                        )}
                      >
                        {formatPluginsName(String(menu))}
                      </p>
                    </button>
                    {isActive ? (
                      <m.div
                        className="absolute inset-0 -left-4 h-full w-[calc(100%+32px)] rounded-md bg-blue-300/50 p-2 dark:bg-gray-800/30"
                        layoutId="active-static-menu"
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="w-full overflow-y-scroll p-6">
        {handleShowOptions(activeStaticMenu || activePreferencePlugin)}
      </div>
    </div>
  )
}

export default SettingsScreen
