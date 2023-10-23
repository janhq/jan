'use client'

import React from 'react'

import ToggleTheme from './toggleTheme'
import ToggleAccent from './toggleAccent'

const AppearanceOptions = () => {
  return (
    <div className="block w-full">
      <div className="border-border flex w-full items-center justify-between border-b py-3 first:pt-0 last:border-none">
        <div className="flex-shrink-0 space-y-1">
          <h6 className="text-sm font-semibold capitalize">Themes</h6>
          <p className="leading-relaxed text-gray-600 dark:text-gray-400">
            Choose your default theme.
          </p>
        </div>
        <ToggleTheme />
      </div>
      <div className="border-border flex w-full items-center justify-between border-b py-3 first:pt-0 last:border-none">
        <div className="flex-shrink-0 space-y-1">
          <h6 className="text-sm font-semibold capitalize">Accent color</h6>
          <p className="leading-relaxed text-gray-600 dark:text-gray-400">
            Choose your accent color.
          </p>
        </div>
        <ToggleAccent />
      </div>
    </div>
  )
}

export default AppearanceOptions
