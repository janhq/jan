import React from 'react'

import { useAtomValue } from 'jotai'

import ModelTable from '../ModelTable'

import { activeAssistantModelAtom } from '@/helpers/atoms/Model.atom'

const ActiveModelTable: React.FC = () => {
  const activeModel = useAtomValue(activeModelAtom)

  if (!activeModel) return null

  return (
    <div className="pl-[63px] pr-[89px]">
      <h3 className="mb-[13px] text-xl leading-[25px]">Active Model(s)</h3>
      <ModelTable models={[activeModel]} />
    </div>
  )
}

export default ActiveModelTable
