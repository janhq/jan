import React, { useState } from 'react'
import { useController } from 'react-hook-form'

type DropdownBoxOption = {
  title: string
  value: unknown
}

type Props = {
  id: string
  title: string
  data: DropdownBoxOption[]
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
  // TODO: NamH handle case data is empty
  const [selected, setSelected] = useState(data[0])
  const { field } = useController({
    name: id,
    control: control,
    rules: { required: required },
  })

  const onSelectedChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    console.log(e)
    const selectedOption = data.find(
      (option) => option.title === e.target.value
    )
    if (selectedOption) {
      setSelected(selectedOption)
    }
  }

  return (
    <div>
      <label className="block font-bold">{title}</label>
      <select
        onSelect={onSelectedChange}
        className="mt-2 block w-full rounded-md border-0 bg-background/80 py-1.5 pl-3 pr-10 text-xs ring-1 ring-inset ring-border focus:ring-2 focus:ring-accent/50 sm:leading-6"
        defaultValue={selected.title}
        {...field}
      >
        {data.map((option) => (
          <option key={option.title}>{option.title}</option>
        ))}
      </select>
    </div>
  )
}

export default DropdownBox
