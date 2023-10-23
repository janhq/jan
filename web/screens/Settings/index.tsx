'use client'
import React from 'react'
import { useEffect, useState } from 'react'

import { motion as m } from 'framer-motion'

import AppearanceOptions from './Appearance'
import PluginCatalog from './CorePlugins/PluginsCatalog'
import PreferencePlugins from './CorePlugins/PreferencePlugins'

import { preferences } from '@janhq/core'
import { twMerge } from 'tailwind-merge'

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
        return (
          <PreferencePlugins
            pluginName={menu}
            preferenceItems={preferenceItems}
            preferenceValues={preferenceValues}
          />
        )
    }
  }

  return (
    <div className="flex h-full">
      <div className="border-border flex h-full w-80 flex-shrink-0 flex-col overflow-y-scroll border-r">
        <div className="p-5">
          <h1 className="text-lg font-bold">Settings</h1>
          <p className="text-muted-foreground mt-2 text-gray-600">
            Manage your account settings
          </p>
          <div className="mt-5 flex-shrink-0">
            <label className="text-muted-foreground font-bold uppercase">
              Options
            </label>
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
                        className="bg-accent/20 absolute inset-0 -left-4 h-full w-[calc(100%+32px)] rounded-md p-2"
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
                        className="bg-accent/20 absolute inset-0 -left-4 h-full w-[calc(100%+32px)]  rounded-md p-2"
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

      <div className="bg-background/50 w-full overflow-y-scroll p-5">
        {handleShowOptions(activeStaticMenu || activePreferencePlugin)}
      </div>
    </div>
  )
}

export default SettingsScreen
