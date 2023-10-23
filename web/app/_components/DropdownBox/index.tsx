import React, { Fragment } from 'react'
import { useController } from 'react-hook-form'

type Props = {
  id: string
  title: string
  data: string[]
  control?: any
  required?: boolean
}

const DropdownBox: React.FC<Props> = ({
  id,
  title,
  data,
  control,
  required = false,
}) => {
  const { field } = useController({
    name: id,
    control: control,
    rules: { required: required },
  })

  return (
    <Fragment>
      <label className="block text-base font-bold text-gray-900">{title}</label>
      <select
        className="mt-2 block w-full rounded-md border-0 py-1.5 pl-3 pr-10 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-indigo-600 sm:text-sm sm:leading-6"
        {...field}
      >
        {data.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </Fragment>
  )
}

export default DropdownBox
