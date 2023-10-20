import React from 'react'
import JanImage from '../JanImage'
import { useSetAtom } from 'jotai'
import { setActiveConvoIdAtom } from '@/_helpers/atoms/Conversation.atom'

const CompactLogo: React.FC = () => {
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom)

  return (
    <button onClick={() => setActiveConvoId(undefined)}>
      <JanImage imageUrl="icons/app_icon.svg" width={28} height={28} />
    </button>
  )
}

export default React.memo(CompactLogo)
