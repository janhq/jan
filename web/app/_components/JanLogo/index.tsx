import { setActiveConvoIdAtom } from '@/_helpers/atoms/Conversation.atom'
import { useSetAtom } from 'jotai'
import Image from 'next/image'
import React from 'react'

const JanLogo: React.FC = () => {
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom)
  return (
    <button
      className="flex items-center gap-0.5 p-3"
      onClick={() => setActiveConvoId(undefined)}
    >
      <Image src={'icons/app_icon.svg'} width={28} height={28} alt="" />
      <Image src={'icons/Jan.svg'} width={27} height={12} alt="" />
    </button>
  )
}

export default React.memo(JanLogo)
