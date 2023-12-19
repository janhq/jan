import { FieldValues, UseFormRegister } from 'react-hook-form'

import { ModelRuntimeParams } from '@janhq/core'
import { Switch } from '@janhq/uikit'

import { useAtomValue } from 'jotai'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import {
  getActiveThreadIdAtom,
  getActiveThreadModelRuntimeParamsAtom,
} from '@/helpers/atoms/Thread.atom'

type Props = {
  name: string
  title: string
  checked: boolean
  register: UseFormRegister<FieldValues>
}

const Checkbox: React.FC<Props> = ({ name, title, checked, register }) => {
  const { updateModelParameter } = useUpdateModelParameters()
  const threadId = useAtomValue(getActiveThreadIdAtom)
  const activeModelParams = useAtomValue(getActiveThreadModelRuntimeParamsAtom)

  const onCheckedChange = (checked: boolean) => {
    if (!threadId || !activeModelParams) return

    const updatedModelParams: ModelRuntimeParams = {
      ...activeModelParams,
      [name]: checked,
    }

    updateModelParameter(threadId, updatedModelParams)
  }

  return (
    <div className="flex justify-between">
      <label>{title}</label>
      <Switch
        checked={checked}
        {...register(name)}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

export default Checkbox
