import React from 'react'

import Image from 'next/image'

type Props = {
  width?: number
  height?: number
  className?: string
}

const LogoMark: React.FC<Props> = ({ width = 24, height = 24, className }) => (
  <Image
    width={width}
    height={height}
    className={className}
    src="icons/app_icon.svg"
    alt="Jan - Logo"
  />
)

export default React.memo(LogoMark)
