import { motion as m } from 'framer-motion'
import { twMerge } from 'tailwind-merge'

import { useUserConfigs } from '@/hooks/useUserConfigs'

type PrimaryColorOption = {
  value: PrimaryColor
  class: string
}

const primaryColorOptions: PrimaryColorOption[] = [
  {
    value: 'primary-blue',
    class: 'bg-blue-500',
  },
  {
    value: 'primary-purple',
    class: 'bg-purple-500',
  },
  {
    value: 'primary-green',
    class: 'bg-green-500',
  },
]

export default function TogglePrimary() {
  const [config, setUserConfig] = useUserConfigs()

  const handleChangeAccent = (primaryColor: PrimaryColor) => {
    setUserConfig({ ...config, primaryColor })
  }

  return (
    <div className="flex items-center">
      {primaryColorOptions.map((option, i) => {
        const isActive = config.primaryColor === option.value
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
                className="absolute inset-0 h-full w-full rounded-full border border-primary/50 bg-primary/20"
                layoutId="active-primary-menu"
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
