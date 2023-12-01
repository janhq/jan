/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState } from 'react'

import { ScrollArea } from '@janhq/uikit'
import { motion as m } from 'framer-motion'

import { twMerge } from 'tailwind-merge'

import Advanced from '@/screens/Settings/Advanced'
import AppearanceOptions from '@/screens/Settings/Appearance'
import ExtensionCatalog from '@/screens/Settings/CoreExtensions/ExtensionsCatalog'
import PreferenceExtensions from '@/screens/Settings/CoreExtensions/PreferenceExtensions'

import { formatExtensionsName } from '@/utils/converter'

const SettingsScreen = () => {
  const [activeStaticMenu, setActiveStaticMenu] = useState('Appearance')
  const [menus, setMenus] = useState<any[]>([])
  const [preferenceItems, setPreferenceItems] = useState<any[]>([])
  const [preferenceValues, setPreferenceValues] = useState<any[]>([])

  useEffect(() => {
    const menu = ['Appearance']

    if (typeof window !== 'undefined' && window.electronAPI) {
      menu.push('Core Extensions')
    }
    menu.push('Advanced')
    setMenus(menu)
  }, [])

  const preferenceExtensions = preferenceItems
    .map((x) => x.extensionnName)
    .filter((x, i) => {
      //     return prefere/nceItems.map((x) => x.extensionName).indexOf(x) === i
    })

  const [activePreferenceExtension, setActivePreferenceExtension] = useState('')

  const handleShowOptions = (menu: string) => {
    switch (menu) {
      case 'Core Extensions':
        return <ExtensionCatalog />

      case 'Appearance':
        return <AppearanceOptions />

      case 'Advanced':
        return <Advanced />

      default:
        return (
          <PreferenceExtensions
            extensionName={menu}
            preferenceItems={preferenceItems}
            preferenceValues={preferenceValues}
          />
        )
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex h-full w-64 flex-shrink-0 flex-col overflow-y-auto border-r border-border">
        <ScrollArea className="h-full w-full">
          <div className="p-4">
            <div className="flex-shrink-0">
              <label className="font-bold uppercase text-muted-foreground">
                Options
              </label>
              <div className="mt-2 font-medium">
                {menus.map((menu, i) => {
                  const isActive = activeStaticMenu === menu
                  return (
                    <div key={i} className="relative my-0.5 block py-1.5">
                      <div
                        onClick={() => {
                          setActiveStaticMenu(menu)
                          setActivePreferenceExtension('')
                        }}
                        className="block w-full cursor-pointer"
                      >
                        <span className={twMerge(isActive && 'relative z-10')}>
                          {menu}
                        </span>
                      </div>
                      {isActive && (
                        <m.div
                          className="absolute inset-0 -left-3 h-full w-[calc(100%+24px)] rounded-md bg-primary/50"
                          layoutId="active-static-menu"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-5 flex-shrink-0">
              {preferenceExtensions.length > 0 && (
                <label className="font-bold uppercase text-muted-foreground">
                  Core Extensions
                </label>
              )}
              <div className="mt-2 font-medium">
                {preferenceExtensions.map((menu, i) => {
                  const isActive = activePreferenceExtension === menu
                  return (
                    <div key={i} className="relative my-0.5 block py-1.5">
                      <div
                        onClick={() => {
                          setActivePreferenceExtension(menu)
                          setActiveStaticMenu('')
                        }}
                        className="block w-full cursor-pointer"
                      >
                        <span
                          className={twMerge(
                            'capitalize',
                            isActive && 'relative z-10'
                          )}
                        >
                          {formatExtensionsName(String(menu))}
                        </span>
                      </div>
                      {isActive ? (
                        <m.div
                          className="absolute inset-0 -left-3 h-full w-[calc(100%+24px)] rounded-md bg-primary/50"
                          layoutId="active-static-menu"
                        />
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      <div className="h-full w-full bg-background/50">
        <ScrollArea className="h-full w-full">
          <div className="p-4">
            {handleShowOptions(activeStaticMenu || activePreferenceExtension)}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

export default SettingsScreen
