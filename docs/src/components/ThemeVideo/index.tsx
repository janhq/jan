import { twMerge } from 'tailwind-merge'

type Props = {
  source: {
    light: string
    dark: string
  }
  className?: string
  width: number
  height: number
}

const ThemeVideo = (props: Props) => {
  const { source, className, width, height } = props

  return (
    <>
      <video
        width={width}
        height={height}
        controls
        autoPlay
        className={twMerge('block dark:hidden', className)}
      >
        <source src={source.light} type="video/mp4" />
      </video>

      <video
        width={width}
        height={height}
        controls
        autoPlay
        className={twMerge('hidden dark:block', className)}
      >
        <source src={source.dark} type="video/mp4" />
      </video>
    </>
  )
}

export default ThemeVideo
