/* eslint-disable @typescript-eslint/no-explicit-any */

import { Controller } from 'react-hook-form'

import { Switch } from '@headlessui/react'

function classNames(...classes: any) {
  return classes.filter(Boolean).join(' ')
}

type Props = {
  id: string
  title: string
  control: any
  required?: boolean
}

const ToggleSwitch: React.FC<Props> = ({
  id,
  title,
  control,
  required = false,
}) => (
  <div className="flex items-center justify-between">
    <div className="text-bold">{title}</div>
    <Controller
      name={id}
      control={control}
      rules={{ required }}
      render={({ field: { value, onChange } }) => (
        <Switch
          checked={value}
          onChange={onChange}
          className={classNames(
            value ? 'bg-accent' : 'bg-gray-200',
            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2'
          )}
        >
          <span className="sr-only">Use setting</span>
          <span
            aria-hidden="true"
            className={classNames(
              value ? 'translate-x-5' : 'translate-x-0',
              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out'
            )}
          />
        </Switch>
      )}
    />
  </div>
)

export default ToggleSwitch
