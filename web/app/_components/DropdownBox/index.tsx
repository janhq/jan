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
      <label className="block font-bold">{title}</label>
      <select
        className="bg-background/80 ring-border focus:ring-accent/50 mt-1 block w-full rounded-md border-0 py-1.5 pl-3 pr-10 text-xs ring-1 ring-inset focus:ring-2 sm:leading-6"
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
