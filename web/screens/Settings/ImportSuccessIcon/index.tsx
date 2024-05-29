import React, { useCallback, useState } from 'react'

import { Check, Pencil } from 'lucide-react'

type Props = {
  onEditModelClick: () => void
}

const ImportSuccessIcon: React.FC<Props> = ({ onEditModelClick }) => {
  const [isHovered, setIsHovered] = useState(false)

  const onMouseOver = () => {
    setIsHovered(true)
  }

  const onMouseOut = () => {
    setIsHovered(false)
  }

  return (
    <div onMouseOver={onMouseOver} onMouseOut={onMouseOut}>
      {isHovered ? (
        <EditIcon onEditModelClick={onEditModelClick} />
      ) : (
        <SuccessIcon />
      )}
    </div>
  )
}

const SuccessIcon = React.memo(() => (
  <div className="bg-primary flex h-8 w-8 items-center justify-center rounded-full text-white">
    <Check size={20} />
  </div>
))

const EditIcon: React.FC<Props> = React.memo(({ onEditModelClick }) => {
  const onClick = useCallback(() => {
    onEditModelClick()
  }, [onEditModelClick])

  return (
    <div
      className="bg-secondary flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg"
      onClick={onClick}
    >
      <Pencil size={20} />
    </div>
  )
})

export default ImportSuccessIcon
