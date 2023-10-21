import React from 'react'
import JanImage from '@containers/JanImage'
import { useSetAtom } from 'jotai'
import { setActiveConvoIdAtom } from '@helpers/atoms/Conversation.atom'

type Props = {
  width?: number
  height?: number
}

const CompactLogo = (props: Props) => {
  const { width = 24, height = 24 } = props
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom)

  return (
    <button onClick={() => setActiveConvoId(undefined)}>
      <JanImage imageUrl="icons/app_icon.svg" width={width} height={height} />
    </button>
  )
}

export default React.memo(CompactLogo)
