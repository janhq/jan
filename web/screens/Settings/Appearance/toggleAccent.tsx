import React from 'react'
import { useUserConfigs } from '@hooks/useUserConfigs'
import { motion as m } from 'framer-motion'
import { twMerge } from 'tailwind-merge'

type AccentOption = {
  value: Accent
  class: string
}

const accentOptions: AccentOption[] = [
  {
    value: 'accent-blue',
    class: 'bg-blue-500',
  },
  {
    value: 'accent-red',
    class: 'bg-red-500',
  },
  {
    value: 'accent-green',
    class: 'bg-green-500',
  },
  {
    value: 'accent-orange',
    class: 'bg-orange-500',
  },
]

const ToggleAccent = () => {
  const [config, setUserConfig] = useUserConfigs()

  const handleChangeAccent = (accent: Accent) => {
    setUserConfig({ ...config, accent })
  }

  return (
    <div className="flex items-center">
      {accentOptions.map((option, i) => {
        const isActive = config.accent === option.value
        return (
          <div
            className="relative flex h-6 w-6 items-center justify-center"
            key={i}
          >
            <button
              className={twMerge('h-3.5 w-3.5 rounded-full', option.class)}
              onClick={() => handleChangeAccent(option.value)}
            />
            {isActive ? (
              <m.div
                className="border-accent/50 bg-accent/20 absolute inset-0 h-full w-full rounded-full border"
                layoutId="active-accent-menu"
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export default ToggleAccent
