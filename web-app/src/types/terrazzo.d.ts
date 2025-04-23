declare module '@terrazzo/react-color-picker' {
  import { FC } from 'react'

  interface ColorPickerProps {
    color: string
    setColor: (color: string) => void
  }

  const ColorPicker: FC<ColorPickerProps>

  export default ColorPicker
}

declare module '@terrazzo/use-color' {
  type UseColorReturn = [string, (color: string) => void]

  function useColor(initialColor: string): UseColorReturn

  export default useColor
}
