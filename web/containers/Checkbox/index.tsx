import React from 'react'

import { Switch } from '@janhq/uikit'

import { useAtomValue } from 'jotai'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import { getActiveThreadIdAtom } from '@/helpers/atoms/Thread.atom'

type Props = {
  name: string
  title: string
  checked: boolean
}

const Checkbox: React.FC<Props> = ({ name, title, checked }) => {
  const { updateModelParameter } = useUpdateModelParameters()
  const threadId = useAtomValue(getActiveThreadIdAtom)

  const onCheckedChange = (checked: boolean) => {
    if (!threadId) return

    updateModelParameter(threadId, name, checked)
  }

  return (
    <div className="flex justify-between">
      <p className="mb-2 text-sm font-semibold text-gray-600">{title}</p>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export default Checkbox
