import React from 'react'

import ToggleTheme from './toggleTheme'

const AppearanceOptions = () => {
  return (
    <div className="block w-full">
      <div className="flex w-full items-center justify-between border-b border-gray-200 py-4 first:pt-0 last:border-none dark:border-gray-800">
        <div className="flex-shrink-0 space-y-1.5">
          <h6 className="text-sm font-semibold">Base color scheme</h6>
          <p className="leading-relaxed text-gray-600 dark:text-gray-400">{`Choose Jan's default color scheme.`}</p>
        </div>
        <ToggleTheme />
      </div>
    </div>
  )
}

export default AppearanceOptions
