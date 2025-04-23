import { useEffect } from 'react'
import { useAppearance } from '@/hooks/useAppearance'
import { useTheme } from '@/hooks/useTheme'
import { isDefaultColor, getDefaultTextColor } from '@/hooks/useAppearance'

/**
 * AppearanceProvider ensures appearance settings are applied on every page load
 * This component should be mounted at the root level of the application
 */
export function AppearanceProvider() {
  const { fontSize, appBgColor, appLeftPanelTextColor } = useAppearance()
  const { isDark } = useTheme()

  // Apply appearance settings on mount and when they change
  useEffect(() => {
    // Apply font size
    document.documentElement.style.setProperty('--font-size-base', fontSize)

    // Apply app background color
    // Import culori functions dynamically to avoid SSR issues
    import('culori').then(({ rgb, oklch, formatCss }) => {
      // Convert RGBA to a format culori can work with
      const culoriRgb = rgb({
        mode: 'rgb',
        r: appBgColor.r / 255,
        g: appBgColor.g / 255,
        b: appBgColor.b / 255,
        alpha: appBgColor.a,
      })

      // Convert to OKLCH for CSS variable
      const oklchColor = oklch(culoriRgb)

      if (oklchColor) {
        document.documentElement.style.setProperty(
          '--app-bg',
          formatCss(oklchColor)
        )
      }
    })

    // Apply text color based on background brightness
    document.documentElement.style.setProperty(
      '--app-left-panel-fg',
      appLeftPanelTextColor
    )
  }, [fontSize, appBgColor, appLeftPanelTextColor, isDark])

  // Update appearance when theme changes
  useEffect(() => {
    // Get the current appearance state
    const { appBgColor, setAppBgColor } = useAppearance.getState()

    // If using default background color, update it when theme changes
    if (isDefaultColor(appBgColor)) {
      // This will trigger the appropriate updates for both background and text color
      setAppBgColor(appBgColor)
    } else {
      // If using custom background, just update the text color if needed
      const textColor = isDefaultColor(appBgColor)
        ? getDefaultTextColor(isDark)
        : appLeftPanelTextColor

      document.documentElement.style.setProperty(
        '--app-left-panel-fg',
        textColor
      )
    }
  }, [isDark, appLeftPanelTextColor])

  return <></>
}
