import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { RgbaColor } from 'react-colorful'
import { rgb, oklch, formatCss } from 'culori'
import { useTheme } from './useTheme'

export type FontSize = '14px' | '15px' | '16px' | '18px'
export type ChatWidth = 'full' | 'compact'

interface AppearanceState {
  chatWidth: ChatWidth
  fontSize: FontSize
  appBgColor: RgbaColor
  appMainViewBgColor: RgbaColor
  appPrimaryBgColor: RgbaColor
  appAccentBgColor: RgbaColor
  appDestructiveBgColor: RgbaColor
  appMainViewTextColor: string
  appPrimaryTextColor: string
  appAccentTextColor: string
  appDestructiveTextColor: string
  appLeftPanelTextColor: string
  setChatWidth: (size: ChatWidth) => void
  setFontSize: (size: FontSize) => void
  setAppBgColor: (color: RgbaColor) => void
  setAppMainViewBgColor: (color: RgbaColor) => void
  setAppPrimaryBgColor: (color: RgbaColor) => void
  setAppAccentBgColor: (color: RgbaColor) => void
  setAppDestructiveBgColor: (color: RgbaColor) => void
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
const defaultAppBgColor: RgbaColor = {
  r: 25,
  g: 25,
  b: 25,
  a: IS_WINDOWS || IS_LINUX || !IS_TAURI ? 1 : 0.4,
}
const defaultLightAppBgColor: RgbaColor = {
  r: 255,
  g: 255,
  b: 255,
  a: IS_WINDOWS || IS_LINUX || !IS_TAURI ? 1 : 0.4,
}
const defaultAppMainViewBgColor: RgbaColor = { r: 25, g: 25, b: 25, a: 1 }
const defaultLightAppMainViewBgColor: RgbaColor = {
  r: 255,
  g: 255,
  b: 255,
  a: 1,
}

const defaultAppPrimaryBgColor: RgbaColor = { r: 219, g: 88, b: 44, a: 1 }
const defaultLightAppPrimaryBgColor: RgbaColor = { r: 219, g: 88, b: 44, a: 1 }
const defaultAppAccentBgColor: RgbaColor = { r: 45, g: 120, b: 220, a: 1 }
const defaultLightAppAccentBgColor: RgbaColor = { r: 45, g: 120, b: 220, a: 1 }
const defaultAppDestructiveBgColor: RgbaColor = { r: 144, g: 60, b: 60, a: 1 }
const defaultLightAppDestructiveBgColor: RgbaColor = {
  r: 217,
  g: 95,
  b: 95,
  a: 1,
}
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

export const isDefaultColorAccent = (color: RgbaColor): boolean => {
  return (
    isColorEqual(color, defaultAppAccentBgColor) ||
    isColorEqual(color, defaultLightAppAccentBgColor)
  )
}

export const isDefaultColorDestructive = (color: RgbaColor): boolean => {
  return (
    isColorEqual(color, defaultAppDestructiveBgColor) ||
    isColorEqual(color, defaultLightAppDestructiveBgColor)
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
        chatWidth: 'compact',
        fontSize: defaultFontSize,
        appBgColor: defaultAppBgColor,
        appMainViewBgColor: defaultAppMainViewBgColor,
        appPrimaryBgColor: defaultAppPrimaryBgColor,
        appAccentBgColor: defaultAppAccentBgColor,
        appDestructiveBgColor: defaultAppDestructiveBgColor,
        appLeftPanelTextColor: getDefaultTextColor(useTheme.getState().isDark),
        appMainViewTextColor: getDefaultTextColor(useTheme.getState().isDark),
        appPrimaryTextColor: getDefaultTextColor(useTheme.getState().isDark),
        appAccentTextColor: getDefaultTextColor(useTheme.getState().isDark),
        appDestructiveTextColor: '#FFF',

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

          // Reset accent color
          const defaultAccent = isDark
            ? defaultAppAccentBgColor
            : defaultLightAppAccentBgColor
          const culoriRgbAccent = rgb({
            mode: 'rgb',
            r: defaultAccent.r / 255,
            g: defaultAccent.g / 255,
            b: defaultAccent.b / 255,
            alpha: defaultAccent.a,
          })
          const oklchAccentColor = oklch(culoriRgbAccent)
          document.documentElement.style.setProperty(
            '--app-accent',
            formatCss(oklchAccentColor)
          )

          // Reset destructive color
          const defaultDestructive = isDark
            ? defaultAppDestructiveBgColor
            : defaultLightAppDestructiveBgColor
          const culoriRgbDestructive = rgb({
            mode: 'rgb',
            r: defaultDestructive.r / 255,
            g: defaultDestructive.g / 255,
            b: defaultDestructive.b / 255,
            alpha: defaultDestructive.a,
          })
          const oklchDestructiveColor = oklch(culoriRgbDestructive)
          document.documentElement.style.setProperty(
            '--app-destructive',
            formatCss(oklchDestructiveColor)
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
          document.documentElement.style.setProperty('--app-accent-fg', '#FFF')
          document.documentElement.style.setProperty(
            '--app-destructive-fg',
            '#FFF'
          )

          // Update state
          set({
            fontSize: defaultFontSize,
            appBgColor: defaultBg,
            appMainViewBgColor: defaultMainView,
            appPrimaryBgColor: defaultPrimary,
            appAccentBgColor: defaultAccent,
            appLeftPanelTextColor: defaultTextColor,
            appMainViewTextColor: defaultTextColor,
            appPrimaryTextColor: '#FFF',
            appAccentTextColor: '#FFF',
            appDestructiveBgColor: defaultDestructive,
            appDestructiveTextColor: '#FFF',
          })
        },

        setChatWidth: (value: ChatWidth) => {
          set({ chatWidth: value })
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

        setAppAccentBgColor: (color: RgbaColor) => {
          // Get the current theme state
          const { isDark } = useTheme.getState()

          // If color is being set to default, use theme-appropriate default
          let finalColorAccent = color
          if (isDefaultColorAccent(color)) {
            finalColorAccent = isDark
              ? defaultAppAccentBgColor
              : defaultLightAppAccentBgColor
          }

          // Convert RGBA to a format culori can work with
          const culoriRgb = rgb({
            mode: 'rgb',
            r: finalColorAccent.r / 255,
            g: finalColorAccent.g / 255,
            b: finalColorAccent.b / 255,
            alpha: finalColorAccent.a,
          })

          // Convert to OKLCH for CSS variable
          const oklchColor = oklch(culoriRgb)

          // Update CSS variable with OKLCH
          document.documentElement.style.setProperty(
            '--app-accent',
            formatCss(oklchColor)
          )

          // Calculate text color based on background brightness or use default based on theme
          let textColor: string

          if (isDefaultColorAccent(color)) {
            // If using default background, use default text color based on theme
            textColor = '#FFF'
          } else {
            // Otherwise calculate based on brightness
            textColor = getBrightness(finalColorAccent) > 128 ? '#000' : '#FFF'
          }

          // Update CSS variable for text color
          document.documentElement.style.setProperty(
            '--app-accent-fg',
            textColor
          )

          // Store the original RGBA and calculated text color in state
          set({
            appAccentBgColor: finalColorAccent,
            appAccentTextColor: textColor,
          })
        },

        setAppDestructiveBgColor: (color: RgbaColor) => {
          // Get the current theme state
          const { isDark } = useTheme.getState()

          // If color is being set to default, use theme-appropriate default
          let finalColorDestructive = color
          if (isDefaultColorDestructive(color)) {
            finalColorDestructive = isDark
              ? defaultAppDestructiveBgColor
              : defaultLightAppDestructiveBgColor
          }

          // Convert RGBA to a format culori can work with
          const culoriRgb = rgb({
            mode: 'rgb',
            r: finalColorDestructive.r / 255,
            g: finalColorDestructive.g / 255,
            b: finalColorDestructive.b / 255,
            alpha: finalColorDestructive.a,
          })

          // Convert to OKLCH for CSS variable
          const oklchColor = oklch(culoriRgb)

          // Update CSS variable with OKLCH
          document.documentElement.style.setProperty(
            '--app-destructive',
            formatCss(oklchColor)
          )

          // Calculate text color based on background brightness or use default based on theme
          let textColor: string

          if (isDefaultColorDestructive(color)) {
            // If using default background, use default text color based on theme
            textColor = '#FFF'
          } else {
            // Otherwise calculate based on brightness
            textColor =
              getBrightness(finalColorDestructive) > 128 ? '#000' : '#FFF'
          }

          // Update CSS variable for text color
          document.documentElement.style.setProperty(
            '--app-destructive-fg',
            textColor
          )

          // Store the original RGBA and calculated text color in state
          set({
            appDestructiveBgColor: finalColorDestructive,
            appDestructiveTextColor: textColor,
          })
        },
      }
    },
    {
      name: localStorageKey.settingAppearance,
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

          let finalColorAccent = state.appAccentBgColor
          if (isDefaultColorAccent(state.appAccentBgColor)) {
            finalColorAccent = isDark
              ? defaultAppAccentBgColor
              : defaultLightAppAccentBgColor
          }

          let finalColorDestructive = state.appDestructiveBgColor
          if (isDefaultColorDestructive(state.appDestructiveBgColor)) {
            finalColorDestructive = isDark
              ? defaultAppDestructiveBgColor
              : defaultLightAppDestructiveBgColor
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

          const culoriRgbAccentColor = rgb({
            mode: 'rgb',
            r: finalColorAccent.r / 255,
            g: finalColorAccent.g / 255,
            b: finalColorAccent.b / 255,
            alpha: finalColorAccent.a,
          })

          const culoriRgbDestructiveColor = rgb({
            mode: 'rgb',
            r: finalColorDestructive.r / 255,
            g: finalColorDestructive.g / 255,
            b: finalColorDestructive.b / 255,
            alpha: finalColorDestructive.a,
          })

          // Convert to OKLCH for CSS variable
          const oklchColor = oklch(culoriRgb)
          const oklchMainViewColor = oklch(culoriRgbMainViewColor)
          const oklchPrimaryColor = oklch(culoriRgbPrimaryColor)
          const oklchAccentColor = oklch(culoriRgbAccentColor)
          const oklchDestructiveColor = oklch(culoriRgbDestructiveColor)

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

          document.documentElement.style.setProperty(
            '--app-accent',
            formatCss(oklchAccentColor)
          )

          document.documentElement.style.setProperty(
            '--app-destructive',
            formatCss(oklchDestructiveColor)
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

          // Calculate and apply text color for accent
          let textColorAccent: string

          if (isDefaultColorAccent(state.appAccentBgColor)) {
            // If using default background, use default text color based on theme
            textColorAccent = getDefaultTextColor(isDark)
          } else {
            // Otherwise calculate based on brightness
            textColorAccent =
              getBrightness(finalColorAccent) > 128 ? '#000' : '#FFF'
          }

          document.documentElement.style.setProperty(
            '--app-accent-fg',
            textColorAccent
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
