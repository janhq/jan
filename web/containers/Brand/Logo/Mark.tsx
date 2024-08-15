import Image from 'next/image'

type Props = {
  width?: number
  height?: number
  className?: string
}

export default function LogoMark(props: Props) {
  const { width = 24, height = 24, className } = props
  return (
    <Image
      width={width}
      height={height}
      className={className}
      src="icons/app_icon.svg"
      alt="Jan - Logo"
    />
  )
}
