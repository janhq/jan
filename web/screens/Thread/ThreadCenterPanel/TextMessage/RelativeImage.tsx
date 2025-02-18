import { useEffect, useState } from 'react'

import { getJanDataFolderPath } from '@janhq/core'

export const RelativeImage = ({
  src,
  onClick,
}: {
  src: string
  onClick?: () => void
}) => {
  const [path, setPath] = useState<string>('')

  useEffect(() => {
    getJanDataFolderPath().then((dataFolderPath) => {
      setPath(dataFolderPath)
    })
  }, [])
  return (
    <button
      onClick={onClick}
      className={onClick ? 'cursor-pointer' : 'cursor-default'}
    >
      <img
        className="aspect-auto"
        alt={src}
        src={src.includes('files/') ? `file://${path}/${src}` : src}
      />
    </button>
  )
}
