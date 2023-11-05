import React from 'react'

type Props = {
  imageUrl: string
  className?: string
  alt?: string
  width?: number
  height?: number
}

const JanImage: React.FC<Props> = ({
  imageUrl,
  className = '',
  alt = '',
  width,
  height,
}) => {
  const [attempt, setAttempt] = React.useState(0)

  return (
    <img
      width={width}
      height={height}
      src={imageUrl}
      alt={alt}
      className={className}
      key={attempt}
      onError={() => setAttempt(attempt + 1)}
    />
  )
}

export default JanImage
