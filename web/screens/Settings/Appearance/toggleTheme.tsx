'use client'

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { twMerge } from 'tailwind-merge'

import { motion as m } from 'framer-motion'

const themeMenus = [
  {
    name: 'light',
  },
  {
    name: 'dark',
  },
  {
    name: 'system',
  },
]

const ToggleTheme = () => {
  const { theme: currentTheme, setTheme } = useTheme()

  const handeleNativeTheme = async (val: string) => {
    switch (val) {
      case 'light':
        return await window?.electronAPI.setNativeThemeLight()
      case 'dark':
        return await window?.electronAPI.setNativeThemeDark()
      default:
        return await window?.electronAPI.setNativeThemeSystem()
    }
  }

  return (
    <div className="flex items-center space-x-1">
      {themeMenus.map((theme, i) => {
        const isActive = currentTheme === theme.name
        return (
          <div className="relative" key={i}>
            <button
              className={twMerge(
                'px-2 py-1 font-semibold capitalize',
                !isActive && 'opacity-50'
              )}
              onClick={async () => {
                setTheme(theme.name)
                handeleNativeTheme(theme.name)
              }}
            >
              {theme.name}
            </button>
            {isActive ? (
              <m.div
                className="absolute inset-0 h-full w-full rounded-md border-2 border-blue-400"
                layoutId="active-theme-menu"
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export default ToggleTheme
