import Image, { ImageProps } from 'next/image'
import { twMerge } from 'tailwind-merge'

type Props = Omit<ImageProps, 'src' | 'priority' | 'loading'> & {
  source: {
    light: string
    dark: string
  }
  className?: string
  alt: string
  width: number
  height: number
  priority?: boolean
}

const ThemeImage = (props: Props) => {
  const { source, className, alt, width, height, priority } = props

  return (
    <>
      <Image
        src={source.light}
        blurDataURL={source.light}
        className={twMerge('block dark:hidden', className)}
        placeholder="blur"
        alt={alt}
        width={width}
        height={height}
        priority={priority}
      />
      <Image
        src={source.dark}
        blurDataURL={source.dark}
        className={twMerge('hidden dark:block', className)}
        placeholder="blur"
        alt={alt}
        width={width}
        height={height}
        priority={priority}
      />
    </>
  )
}

export default ThemeImage
