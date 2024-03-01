import { useEffect, useState } from 'react'

import { getJanDataFolderPath } from '@janhq/core'

export const RelativeImage = ({
  id,
  src,
  onClick,
}: {
  id: string
  src: string
  onClick: () => void
}) => {
  const [path, setPath] = useState<string>('')

  useEffect(() => {
    getJanDataFolderPath().then((dataFolderPath) => {
      setPath(dataFolderPath)
    })
  }, [])
  return (
    <button onClick={onClick}>
      <img
        className="aspect-auto h-[300px] cursor-pointer"
        alt={id}
        src={src.includes('files/') ? `file://${path}/${src}` : src}
      />
    </button>
  )
}
