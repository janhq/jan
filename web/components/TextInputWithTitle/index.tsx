/* eslint-disable @typescript-eslint/no-explicit-any */

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
      <div className="font-bold">{title}</div>
      <div className="text-muted-foreground pb-2">{description}</div>
      <input
        className="placeholder:text-muted-foreground focus:ring-accent/50 block w-full rounded-md border-0 bg-background/80 py-1.5 text-xs shadow-sm ring-1 ring-inset ring-border focus:ring-2 focus:ring-inset sm:leading-6"
        placeholder={placeholder}
        {...field}
      />
    </div>
  )
}

export default TextInputWithTitle
