/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState } from 'react'

import { ScrollArea } from '@janhq/uikit'
import { motion as m } from 'framer-motion'

import { twMerge } from 'tailwind-merge'

import Advanced from '@/screens/Settings/Advanced'
import AppearanceOptions from '@/screens/Settings/Appearance'
import ExtensionCatalog from '@/screens/Settings/CoreExtensions'

import Models from '@/screens/Settings/Models'

import { SUCCESS_SET_NEW_DESTINATION } from './Advanced/DataFolder'

const SettingsScreen = () => {
  const [activeStaticMenu, setActiveStaticMenu] = useState('My Models')
  const [menus, setMenus] = useState<any[]>([])

  useEffect(() => {
    const menu = ['My Models', 'My Settings', 'Advanced Settings']

    if (typeof window !== 'undefined' && window.electronAPI) {
      menu.push('Extensions')
    }
    setMenus(menu)
  }, [])

  const [activePreferenceExtension, setActivePreferenceExtension] = useState('')

  const handleShowOptions = (menu: string) => {
    switch (menu) {
      case 'Extensions':
        return <ExtensionCatalog />

      case 'My Settings':
        return <AppearanceOptions />

      case 'Advanced Settings':
        return <Advanced />

      case 'My Models':
        return <Models />
    }
  }

  useEffect(() => {
    if (localStorage.getItem(SUCCESS_SET_NEW_DESTINATION) === 'true') {
      setActiveStaticMenu('Advanced Settings')
      localStorage.removeItem(SUCCESS_SET_NEW_DESTINATION)
    }
  }, [])

  return (
    <div
      className="flex h-full bg-background"
      data-testid="testid-setting-description"
    >
      <div className="flex h-full w-64 flex-shrink-0 flex-col overflow-y-auto border-r border-border">
        <ScrollArea className="h-full w-full">
          <div className="px-6 py-4">
            <div className="flex-shrink-0">
              <div className="font-medium">
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
          </div>
        </ScrollArea>
      </div>

      <div className="h-full w-full bg-background">
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
