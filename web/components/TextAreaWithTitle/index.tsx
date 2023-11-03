/* eslint-disable @typescript-eslint/no-explicit-any */

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
      <label htmlFor="comment" className="block font-bold">
        {title}
      </label>
      {description && (
        <p className="text-muted-foreground mt-1 font-normal">{description}</p>
      )}
      <textarea
        rows={4}
        className="text-background-reverse placeholder:text-muted-foreground focus:ring-accent/50 block w-full resize-none rounded-md border-0 bg-background/80 py-1.5 text-xs leading-relaxed shadow-sm ring-1 ring-inset ring-border focus:ring-2 focus:ring-inset"
        placeholder={placeholder}
        {...field}
      />
    </div>
  )
}

export default TextAreaWithTitle
