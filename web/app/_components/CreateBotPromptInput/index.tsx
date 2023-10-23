import React, { Fragment, use } from 'react'
import ToggleSwitch from '../ToggleSwitch'
import { useController } from 'react-hook-form'

type Props = {
  id: string
  control?: any
  required?: boolean
}

const CreateBotPromptInput: React.FC<Props> = ({ id, control, required }) => {
  const { field } = useController({
    name: id,
    control: control,
    rules: { required: required },
  })

  return (
    <Fragment>
      <div className="flex flex-col gap-2">
        <label htmlFor="comment" className="block font-bold ">
          Prompt
        </label>
        <p className="mt-1 font-normal text-gray-400">
          All conversations with this bot will start with your prompt but it
          will not be visible to the user in the chat. If you would like the
          prompt message to be visible to the user, consider using an intro
          message instead.
        </p>
        <ToggleSwitch
          id="visibleFromBotProfile"
          title={'Prompt visible from bot profile'}
          control={control}
        />
        <textarea
          rows={4}
          className="block w-full resize-none rounded-md border-0 bg-background/80 py-1.5 text-xs leading-relaxed text-background-reverse shadow-sm ring-1 ring-inset ring-border placeholder:text-muted-foreground focus:ring-2 focus:ring-inset focus:ring-accent/50"
          placeholder="Talk to me like a pirate"
          {...field}
        />
      </div>
    </Fragment>
  )
}

export default CreateBotPromptInput
