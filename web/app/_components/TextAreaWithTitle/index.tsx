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
      <label htmlFor="comment" className="block font-bold">
        {title}
      </label>
      {description && (
        <p className="mt-1 font-normal text-muted-foreground">{description}</p>
      )}
      <textarea
        rows={4}
        className="block w-full resize-none rounded-md border-0 bg-background/80 py-1.5 text-xs leading-relaxed text-background-reverse shadow-sm ring-1 ring-inset ring-border placeholder:text-muted-foreground focus:ring-2 focus:ring-inset focus:ring-accent/50"
        placeholder={placeholder}
        {...field}
      />
    </div>
  )
}

export default TextAreaWithTitle
