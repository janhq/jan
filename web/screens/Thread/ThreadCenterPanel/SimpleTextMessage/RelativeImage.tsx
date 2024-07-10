import { useEffect, useState } from 'react'

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
