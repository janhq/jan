import React from 'react'
import { useController } from 'react-hook-form'

type Props = {
  id: string
  title: string
  placeholder: string
  description?: string
  control?: any
  required?: boolean
}

const TextAreaWithTitle: React.FC<Props> = ({
  id,
  title,
  placeholder,
  description,
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
      <label
        htmlFor="comment"
        className="block text-base font-bold text-gray-900"
      >
        {title}
      </label>
      {description && (
        <p className="text-sm font-normal text-gray-400">{description}</p>
      )}
      <textarea
        rows={4}
        className="block w-full resize-none rounded-md border-0 bg-transparent py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
        placeholder={placeholder}
        {...field}
      />
    </div>
  )
}

export default TextAreaWithTitle
