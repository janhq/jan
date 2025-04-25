import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStoregeKey } from '@/constants/localStorage'
import { RgbaColor } from 'react-colorful'
import { rgb, oklch, formatCss } from 'culori'
import { useTheme } from './useTheme'

export type FontSize = '14px' | '15px' | '16px' | '18px'

interface AppearanceState {
  fontSize: FontSize
  appBgColor: RgbaColor
  appMainViewBgColor: RgbaColor
  appPrimaryBgColor: RgbaColor
  appMainViewTextColor: string
  appPrimaryTextColor: string
  appLeftPanelTextColor: string
  setFontSize: (size: FontSize) => void
  setAppBgColor: (color: RgbaColor) => void
  setAppMainViewBgColor: (color: RgbaColor) => void
  setAppPrimaryBgColor: (color: RgbaColor) => void
  resetAppearance: () => void
}

const getBrightness = ({ r, g, b }: RgbaColor) =>
  (r * 299 + g * 587 + b * 114) / 1000

export const fontSizeOptions = [
  { label: 'Small', value: '14px' as FontSize },
  { label: 'Medium', value: '15px' as FontSize },
  { label: 'Large', value: '16px' as FontSize },
  { label: 'Extra Large', value: '18px' as FontSize },
]

// Default appearance settings
const defaultFontSize: FontSize = '15px'
const defaultAppBgColor: RgbaColor = { r: 0, g: 0, b: 0, a: 0.4 }
const defaultLightAppBgColor: RgbaColor = { r: 255, g: 255, b: 255, a: 0.4 }
const defaultAppMainViewBgColor: RgbaColor = { r: 25, g: 25, b: 25, a: 1 }
const defaultLightAppMainViewBgColor: RgbaColor = {
  r: 250,
  g: 250,
  b: 250,
  a: 1,
}
const defaultAppPrimaryBgColor: RgbaColor = { r: 45, g: 80, b: 220, a: 1 }
const defaultLightAppPrimaryBgColor: RgbaColor = { r: 45, g: 80, b: 220, a: 1 }
const defaultDarkLeftPanelTextColor: string = '#FFF'
const defaultLightLeftPanelTextColor: string = '#000'

// Helper function to check if two RGBA colors are equal
const isColorEqual = (color1: RgbaColor, color2: RgbaColor): boolean => {
  return (
    color1.r === color2.r &&
    color1.g === color2.g &&
    color1.b === color2.b &&
    color1.a === color2.a
  )
}

// Helper function to check if color is default (not customized)
export const isDefaultColor = (color: RgbaColor): boolean => {
  return (
    isColorEqual(color, defaultAppBgColor) ||
    isColorEqual(color, defaultLightAppBgColor)
  )
}

export const isDefaultColorMainView = (color: RgbaColor): boolean => {
  return (
    isColorEqual(color, defaultAppMainViewBgColor) ||
    isColorEqual(color, defaultLightAppMainViewBgColor)
  )
}

export const isDefaultColorPrimary = (color: RgbaColor): boolean => {
  return (
    isColorEqual(color, defaultAppPrimaryBgColor) ||
    isColorEqual(color, defaultLightAppPrimaryBgColor)
  )
}

// Helper function to get default text color based on theme
export const getDefaultTextColor = (isDark: boolean): string => {
  return isDark ? defaultDarkLeftPanelTextColor : defaultLightLeftPanelTextColor
}

export const useAppearance = create<AppearanceState>()(
  persist(
    (set) => {
      return {
        fontSize: defaultFontSize,
        appBgColor: defaultAppBgColor,
        appMainViewBgColor: defaultAppMainViewBgColor,
        appPrimaryBgColor: defaultAppPrimaryBgColor,
        appLeftPanelTextColor: getDefaultTextColor(useTheme.getState().isDark),
        appMainViewTextColor: getDefaultTextColor(useTheme.getState().isDark),
        appPrimaryTextColor: getDefaultTextColor(useTheme.getState().isDark),

        resetAppearance: () => {
          const { isDark } = useTheme.getState()

          // Reset font size
          document.documentElement.style.setProperty(
            '--font-size-base',
            defaultFontSize
          )

          // Reset app background color
          const defaultBg = isDark ? defaultAppBgColor : defaultLightAppBgColor
          const culoriRgbBg = rgb({
            mode: 'rgb',
            r: defaultBg.r / 255,
            g: defaultBg.g / 255,
            b: defaultBg.b / 255,
            alpha: defaultBg.a,
          })
          const oklchBgColor = oklch(culoriRgbBg)
          document.documentElement.style.setProperty(
            '--app-bg',
            formatCss(oklchBgColor)
          )

          // Reset main view background color
          const defaultMainView = isDark
            ? defaultAppMainViewBgColor
            : defaultLightAppMainViewBgColor
          const culoriRgbMainView = rgb({
            mode: 'rgb',
            r: defaultMainView.r / 255,
            g: defaultMainView.g / 255,
            b: defaultMainView.b / 255,
            alpha: defaultMainView.a,
          })
          const oklchMainViewColor = oklch(culoriRgbMainView)
          document.documentElement.style.setProperty(
            '--app-main-view',
            formatCss(oklchMainViewColor)
          )

          // Reset primary color
          const defaultPrimary = isDark
            ? defaultAppPrimaryBgColor
            : defaultLightAppPrimaryBgColor
          const culoriRgbPrimary = rgb({
            mode: 'rgb',
            r: defaultPrimary.r / 255,
            g: defaultPrimary.g / 255,
            b: defaultPrimary.b / 255,
            alpha: defaultPrimary.a,
          })
          const oklchPrimaryColor = oklch(culoriRgbPrimary)
          document.documentElement.style.setProperty(
            '--app-primary',
            formatCss(oklchPrimaryColor)
          )

          // Reset text colors
          const defaultTextColor = getDefaultTextColor(isDark)
          document.documentElement.style.setProperty(
            '--text-color',
            defaultTextColor
          )
          document.documentElement.style.setProperty(
            '--app-left-panel-fg',
            defaultTextColor
          )
          document.documentElement.style.setProperty(
            '--app-main-view-fg',
            defaultTextColor
          )
          document.documentElement.style.setProperty('--app-primary-fg', '#FFF')

          // Update state
          set({
            fontSize: defaultFontSize,
            appBgColor: defaultBg,
            appMainViewBgColor: defaultMainView,
            appPrimaryBgColor: defaultPrimary,
            appLeftPanelTextColor: defaultTextColor,
            appMainViewTextColor: defaultTextColor,
            appPrimaryTextColor: '#FFF',
          })
        },

        setFontSize: (size: FontSize) => {
          // Update CSS variable
          document.documentElement.style.setProperty('--font-size-base', size)
          // Update state
          set({ fontSize: size })
        },

        setAppBgColor: (color: RgbaColor) => {
          // Get the current theme state
          const { isDark } = useTheme.getState()

          // If color is being set to default, use theme-appropriate default
          let finalColor = color
          if (isDefaultColor(color)) {
            finalColor = isDark ? defaultAppBgColor : defaultLightAppBgColor
          }

          // Convert RGBA to a format culori can work with
          const culoriRgb = rgb({
            mode: 'rgb',
            r: finalColor.r / 255,
            g: finalColor.g / 255,
            b: finalColor.b / 255,
            alpha: finalColor.a,
          })

          // Convert to OKLCH for CSS variable
          const oklchColor = oklch(culoriRgb)

          // Update CSS variable with OKLCH
          document.documentElement.style.setProperty(
            '--app-bg',
            formatCss(oklchColor)
          )

          // Calculate text color based on background brightness or use default based on theme
          let textColor: string

          if (isDefaultColor(color)) {
            // If using default background, use default text color based on theme
            textColor = getDefaultTextColor(isDark)
          } else {
            // Otherwise calculate based on brightness
            textColor = getBrightness(finalColor) > 128 ? '#000' : '#FFF'
          }

          // Update CSS variable for text color
          document.documentElement.style.setProperty('--text-color', textColor)

          // Store the original RGBA and calculated text color in state
          set({ appBgColor: finalColor, appLeftPanelTextColor: textColor })
        },

        setAppMainViewBgColor: (color: RgbaColor) => {
          // Get the current theme state
          const { isDark } = useTheme.getState()

          // If color is being set to default, use theme-appropriate default
          let finalColorMainView = color
          if (isDefaultColorMainView(color)) {
            finalColorMainView = isDark
              ? defaultAppMainViewBgColor
              : defaultLightAppMainViewBgColor
          }

          // Convert RGBA to a format culori can work with
          const culoriRgb = rgb({
            mode: 'rgb',
            r: finalColorMainView.r / 255,
            g: finalColorMainView.g / 255,
            b: finalColorMainView.b / 255,
            alpha: finalColorMainView.a,
          })

          // Convert to OKLCH for CSS variable
          const oklchColor = oklch(culoriRgb)

          // Update CSS variable with OKLCH
          document.documentElement.style.setProperty(
            '--app-main-view',
            formatCss(oklchColor)
          )

          // Calculate text color based on background brightness or use default based on theme
          let textColor: string

          if (isDefaultColor(color)) {
            // If using default background, use default text color based on theme
            textColor = getDefaultTextColor(isDark)
          } else {
            // Otherwise calculate based on brightness
            textColor =
              getBrightness(finalColorMainView) > 128 ? '#000' : '#FFF'
          }

          // Update CSS variable for text color
          document.documentElement.style.setProperty(
            '--app-main-view-fg',
            textColor
          )

          // Store the original RGBA and calculated text color in state
          set({
            appMainViewBgColor: finalColorMainView,
            appMainViewTextColor: textColor,
          })
        },

        setAppPrimaryBgColor: (color: RgbaColor) => {
          // Get the current theme state
          const { isDark } = useTheme.getState()

          // If color is being set to default, use theme-appropriate default
          let finalColorPrimary = color
          if (isDefaultColorPrimary(color)) {
            finalColorPrimary = isDark
              ? defaultAppPrimaryBgColor
              : defaultLightAppPrimaryBgColor
          }

          // Convert RGBA to a format culori can work with
          const culoriRgb = rgb({
            mode: 'rgb',
            r: finalColorPrimary.r / 255,
            g: finalColorPrimary.g / 255,
            b: finalColorPrimary.b / 255,
            alpha: finalColorPrimary.a,
          })

          // Convert to OKLCH for CSS variable
          const oklchColor = oklch(culoriRgb)

          // Update CSS variable with OKLCH
          document.documentElement.style.setProperty(
            '--app-primary',
            formatCss(oklchColor)
          )

          // Calculate text color based on background brightness or use default based on theme
          let textColor: string

          if (isDefaultColorPrimary(color)) {
            // If using default background, use default text color based on theme
            textColor = '#FFF'
          } else {
            // Otherwise calculate based on brightness
            textColor = getBrightness(finalColorPrimary) > 128 ? '#000' : '#FFF'
          }

          // Update CSS variable for text color
          document.documentElement.style.setProperty(
            '--app-primary-fg',
            textColor
          )

          // Store the original RGBA and calculated text color in state
          set({
            appPrimaryBgColor: finalColorPrimary,
            appPrimaryTextColor: textColor,
          })
        },
      }
    },
    {
      name: localStoregeKey.settingAppearance,
      storage: createJSONStorage(() => localStorage),
      // Apply settings when hydrating from storage
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Apply font size from storage
          document.documentElement.style.setProperty(
            '--font-size-base',
            state.fontSize
          )

          // Get the current theme state
          const { isDark } = useTheme.getState()

          // If stored color is default, use theme-appropriate default
          let finalColor = state.appBgColor
          if (isDefaultColor(state.appBgColor)) {
            finalColor = isDark ? defaultAppBgColor : defaultLightAppBgColor
          }

          let finalColorMainView = state.appMainViewBgColor
          if (isDefaultColorMainView(state.appMainViewBgColor)) {
            finalColorMainView = isDark
              ? defaultAppMainViewBgColor
              : defaultLightAppMainViewBgColor
          }

          let finalColorPrimary = state.appPrimaryBgColor
          if (isDefaultColorPrimary(state.appPrimaryBgColor)) {
            finalColorPrimary = isDark
              ? defaultAppPrimaryBgColor
              : defaultLightAppPrimaryBgColor
          }

          // Apply app background color from storage
          // Convert RGBA to a format culori can work with
          const culoriRgb = rgb({
            mode: 'rgb',
            r: finalColor.r / 255,
            g: finalColor.g / 255,
            b: finalColor.b / 255,
            alpha: finalColor.a,
          })

          const culoriRgbMainViewColor = rgb({
            mode: 'rgb',
            r: finalColorMainView.r / 255,
            g: finalColorMainView.g / 255,
            b: finalColorMainView.b / 255,
            alpha: finalColorMainView.a,
          })

          const culoriRgbPrimaryColor = rgb({
            mode: 'rgb',
            r: finalColorPrimary.r / 255,
            g: finalColorPrimary.g / 255,
            b: finalColorPrimary.b / 255,
            alpha: finalColorPrimary.a,
          })

          // Convert to OKLCH for CSS variable
          const oklchColor = oklch(culoriRgb)
          const oklchMainViewColor = oklch(culoriRgbMainViewColor)
          const oklchPrimaryColor = oklch(culoriRgbPrimaryColor)

          document.documentElement.style.setProperty(
            '--app-bg',
            formatCss(oklchColor)
          )

          document.documentElement.style.setProperty(
            '--app-main-view',
            formatCss(oklchMainViewColor)
          )

          document.documentElement.style.setProperty(
            '--app-primary',
            formatCss(oklchPrimaryColor)
          )

          // Calculate and apply text color
          let textColor: string

          if (isDefaultColor(state.appBgColor)) {
            // If using default background, use default text color based on theme
            textColor = getDefaultTextColor(isDark)
          } else {
            // Otherwise calculate based on brightness
            textColor = getBrightness(finalColor) > 128 ? '#000' : '#FFF'
          }

          document.documentElement.style.setProperty(
            '--app-left-panel-fg',
            textColor
          )

          // Calculate and apply text color for main view
          let textColorMainView: string

          if (isDefaultColorMainView(state.appMainViewBgColor)) {
            // If using default background, use default text color based on theme
            textColorMainView = getDefaultTextColor(isDark)
          } else {
            // Otherwise calculate based on brightness
            textColorMainView =
              getBrightness(finalColorMainView) > 128 ? '#000' : '#FFF'
          }

          document.documentElement.style.setProperty(
            '--app-main-view-fg',
            textColorMainView
          )

          // Calculate and apply text color for primary
          let textColorPrimary: string

          if (isDefaultColorPrimary(state.appPrimaryBgColor)) {
            // If using default background, use default text color based on theme
            textColorPrimary = getDefaultTextColor(isDark)
          } else {
            // Otherwise calculate based on brightness
            textColorPrimary =
              getBrightness(finalColorPrimary) > 128 ? '#000' : '#FFF'
          }

          document.documentElement.style.setProperty(
            '--app-primary-fg',
            textColorPrimary
          )

          // We don't need to update the state here as it will be handled by the store
          // The state will be updated with the hydrated values automatically
        }

        // Return the state to be used for hydration
        return state
      },
    }
  )
)
