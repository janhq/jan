import React, { useCallback, useState } from 'react'
import { CircularProgressbar } from 'react-circular-progressbar'

import { X } from 'lucide-react'

type Props = {
  percentage: number
  onDeleteModelClick: () => void
}

const ImportInProgressIcon: React.FC<Props> = ({
  percentage,
  onDeleteModelClick,
}) => {
  const [isHovered, setIsHovered] = useState(false)

  const onMouseOver = () => {
    // for now we don't allow user to cancel importing
    setIsHovered(false)
  }

  const onMouseOut = () => {
    setIsHovered(false)
  }

  return (
    <div onMouseOver={onMouseOver} onMouseOut={onMouseOut}>
      {isHovered ? (
        <DeleteIcon onDeleteModelClick={onDeleteModelClick} />
      ) : (
        <ProgressIcon percentage={percentage} />
      )}
    </div>
  )
}

const ProgressIcon: React.FC<Partial<Props>> = ({ percentage }) => (
  <div className="h-8 w-8 rounded-full">
    <CircularProgressbar value={(percentage ?? 0) * 100} />
  </div>
)

const DeleteIcon: React.FC<Partial<Props>> = React.memo(
  ({ onDeleteModelClick }) => {
    const onClick = useCallback(() => {
      onDeleteModelClick?.()
    }, [onDeleteModelClick])

    return (
      <div
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-gray-100"
        onClick={onClick}
      >
        <X />
      </div>
    )
  }
)

export default ImportInProgressIcon
