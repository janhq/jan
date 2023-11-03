'use client'
import React from 'react'
import { useEffect, useState } from 'react'

import { motion as m } from 'framer-motion'

import AppearanceOptions from './Appearance'
import PluginCatalog from './CorePlugins/PluginsCatalog'
import PreferencePlugins from './CorePlugins/PreferencePlugins'

import { twMerge } from 'tailwind-merge'

import { formatPluginsName } from '@utils/converter'

import Advanced from './Advanced'

const SettingsScreen = () => {
  const [activeStaticMenu, setActiveStaticMenu] = useState('Appearance')
  const [preferenceItems, setPreferenceItems] = useState<any[]>([])
  const [preferenceValues, setPreferenceValues] = useState<any[]>([])
  const [menus, setMenus] = useState<any[]>([])

  useEffect(() => {
    const menu = ['Appearance']

    if (typeof window !== 'undefined' && window.electronAPI) {
      menu.push('Core Plugins')
    }
    menu.push('Advanced')
    setMenus(menu)
  }, [])

  /**
   * Fetches the active plugins and their preferences from the `plugins` and `preferences` modules.
   * If the `experimentComponent` extension point is available, it executes the extension point and
   * appends the returned components to the `experimentRef` element.
   * If the `PluginPreferences` extension point is available, it executes the extension point and
   * fetches the preferences for each plugin using the `preferences.get` function.
   */
  useEffect(() => {
    const getActivePluginPreferences = async () => {
      // setPreferenceItems(Array.isArray(data) ? data : [])
      // TODO: Add back with new preferences mechanism
      // Promise.all(
      //   (Array.isArray(data) ? data : []).map((e) =>
      //     preferences
      //       .get(e.pluginName, e.preferenceKey)
      //       .then((k) => ({ key: e.preferenceKey, value: k }))
      //   )
      // ).then((data) => {
      //   setPreferenceValues(data)
      // })
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

      case 'Advanced':
        return <Advanced />

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
      <div className="flex h-full w-80 flex-shrink-0 flex-col overflow-y-auto border-r border-border">
        <div className="p-5">
          <h1 className="text-lg font-bold">Settings</h1>
          <p
            data-testid="testid-setting-description"
            className="mt-2 text-gray-600 text-muted-foreground"
          >
            Manage your account settings
          </p>
          <div className="mt-5 flex-shrink-0">
            <label className="font-bold uppercase text-muted-foreground">
              Options
            </label>
            <div className="mt-1 font-semibold">
              {menus.map((menu, i) => {
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
                        className="absolute inset-0 -left-4 h-full w-[calc(100%+32px)] rounded-md bg-accent/20 p-2"
                        layoutId="active-static-menu"
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="mt-5 flex-shrink-0">
            {preferencePlugins.length > 0 && (
              <label className="font-bold uppercase text-gray-500">
                Core plugins
              </label>
            )}
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
                        className="absolute inset-0 -left-4 h-full w-[calc(100%+32px)] rounded-md  bg-accent/20 p-2"
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

      <div className="w-full overflow-y-auto bg-background/50 p-5">
        {handleShowOptions(activeStaticMenu || activePreferencePlugin)}
      </div>
    </div>
  )
}

export default SettingsScreen
