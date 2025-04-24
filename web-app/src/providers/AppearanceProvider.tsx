import { useEffect } from 'react'
import { useAppearance } from '@/hooks/useAppearance'
import { useTheme } from '@/hooks/useTheme'
import {
  isDefaultColor,
  getDefaultTextColor,
  isDefaultColorMainView,
  isDefaultColorPrimary,
} from '@/hooks/useAppearance'

/**
 * AppearanceProvider ensures appearance settings are applied on every page load
 * This component should be mounted at the root level of the application
 */
export function AppearanceProvider() {
  const {
    fontSize,
    appBgColor,
    appLeftPanelTextColor,
    appMainViewBgColor,
    appMainViewTextColor,
    appPrimaryBgColor,
    appPrimaryTextColor,
  } = useAppearance()
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

      const culoriRgbMainView = rgb({
        mode: 'rgb',
        r: appMainViewBgColor.r / 255,
        g: appMainViewBgColor.g / 255,
        b: appMainViewBgColor.b / 255,
        alpha: appMainViewBgColor.a,
      })

      const culoriRgbPrimary = rgb({
        mode: 'rgb',
        r: appPrimaryBgColor.r / 255,
        g: appPrimaryBgColor.g / 255,
        b: appPrimaryBgColor.b / 255,
        alpha: appPrimaryBgColor.a,
      })

      // Convert to OKLCH for CSS variable
      const oklchColor = oklch(culoriRgb)
      const oklchColormainViewApp = oklch(culoriRgbMainView)
      const oklchColorPrimary = oklch(culoriRgbPrimary)

      if (oklchColor) {
        document.documentElement.style.setProperty(
          '--app-bg',
          formatCss(oklchColor)
        )
      }
      if (oklchColormainViewApp) {
        document.documentElement.style.setProperty(
          '--app-main-view',
          formatCss(oklchColormainViewApp)
        )
      }
      if (oklchColorPrimary) {
        document.documentElement.style.setProperty(
          '--app-primary',
          formatCss(oklchColorPrimary)
        )
      }
    })

    // Apply text color based on background brightness
    document.documentElement.style.setProperty(
      '--app-left-panel-fg',
      appLeftPanelTextColor
    )

    // Apply text color based on background brightness
    document.documentElement.style.setProperty(
      '--app-main-view-fg',
      appMainViewTextColor
    )

    // Apply text color based on background brightness for primary
    document.documentElement.style.setProperty(
      '--app-primary-fg',
      appPrimaryTextColor
    )
  }, [
    fontSize,
    appBgColor,
    appLeftPanelTextColor,
    isDark,
    appMainViewBgColor,
    appMainViewTextColor,
    appPrimaryBgColor,
    appPrimaryTextColor,
  ])

  // Update appearance when theme changes
  useEffect(() => {
    // Get the current appearance state
    const {
      appBgColor,
      appMainViewBgColor,
      appPrimaryBgColor,
      setAppBgColor,
      setAppMainViewBgColor,
      setAppPrimaryBgColor,
    } = useAppearance.getState()

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

    // If using default background color, update it when theme changes
    if (isDefaultColorMainView(appMainViewBgColor)) {
      // This will trigger the appropriate updates for both background and text color
      setAppMainViewBgColor(appMainViewBgColor)
    } else {
      // If using custom background, just update the text color if needed
      const textColorMainView = isDefaultColor(appMainViewBgColor)
        ? getDefaultTextColor(isDark)
        : appMainViewTextColor

      document.documentElement.style.setProperty(
        '--app-main-view-fg',
        textColorMainView
      )
    }

    // If using default primary color, update it when theme changes
    if (isDefaultColorPrimary(appPrimaryBgColor)) {
      // This will trigger the appropriate updates for both background and text color
      setAppPrimaryBgColor(appPrimaryBgColor)
    } else {
      // If using custom background, just update the text color if needed
      const textColorPrimary = isDefaultColorPrimary(appPrimaryBgColor)
        ? getDefaultTextColor(isDark)
        : appPrimaryTextColor

      document.documentElement.style.setProperty(
        '--app-primary-fg',
        textColorPrimary
      )
    }
  }, [isDark, appLeftPanelTextColor, appMainViewTextColor, appPrimaryTextColor])

  return null
}
