import React from 'react'
import { useController } from 'react-hook-form'

type Props = {
  id: string
  title: string
  description: string
  placeholder?: string
  control?: any
  required?: boolean
}

const TextInputWithTitle: React.FC<Props> = ({
  id,
  title,
  description,
  placeholder,
  control,
  required = false,
}) => {
  const { field } = useController({
    name: id,
    control: control,
    rules: { required: required },
  })

  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold text-gray-900">{title}</div>
      <div className="pb-2 text-sm text-[#737d7d]">{description}</div>
      <input
        className="block w-full rounded-md border-0 bg-transparent py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
        placeholder={placeholder}
        {...field}
      />
    </div>
  )
}

export default TextInputWithTitle
