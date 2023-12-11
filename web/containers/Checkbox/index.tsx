/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react'

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
  register: any
}

const Checkbox: React.FC<Props> = ({ name, title, checked, register }) => {
  const [currentChecked, setCurrentChecked] = useState<boolean>(checked)
  const { updateModelParameter } = useUpdateModelParameters()
  const threadId = useAtomValue(getActiveThreadIdAtom)
  const activeModelParams = useAtomValue(getActiveThreadModelRuntimeParamsAtom)

  useEffect(() => {
    setCurrentChecked(checked)
  }, [checked])

  useEffect(() => {
    updateSetting()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChecked])

  const updateValue = [name].reduce((accumulator, value) => {
    return { ...accumulator, [value]: currentChecked }
  }, {})

  const updateSetting = () => {
    return updateModelParameter(String(threadId), {
      ...activeModelParams,
      ...updateValue,
    })
  }

  return (
    <div className="flex justify-between">
      <label>{title}</label>
      <Switch
        checked={currentChecked}
        {...register(name)}
        onCheckedChange={(e) => {
          setCurrentChecked(e)
        }}
      />
    </div>
  )
}

export default Checkbox
