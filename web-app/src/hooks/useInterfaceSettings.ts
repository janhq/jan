import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
<<<<<<< HEAD
import { RgbaColor } from 'react-colorful'
import { rgb, oklch, formatCss } from 'culori'
import { useTheme } from './useTheme'
import { useEffect, useState } from 'react'
import { getServiceHub } from '@/hooks/useServiceHub'
import { supportsBlurEffects } from '@/utils/blurSupport'
import {
  DEFAULT_THREAD_SCROLL_BEHAVIOR,
  ThreadScrollBehavior,
  isThreadScrollBehavior,
} from '@/constants/threadScroll'

export type FontSize = '14px' | '15px' | '16px' | '18px'
export type ChatWidth = 'full' | 'compact'

interface InterfaceSettingsState {
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
  threadScrollBehavior: ThreadScrollBehavior
  setChatWidth: (size: ChatWidth) => void
  setFontSize: (size: FontSize) => void
  setAppBgColor: (color: RgbaColor) => void
  setAppMainViewBgColor: (color: RgbaColor) => void
  setAppPrimaryBgColor: (color: RgbaColor) => void
  setAppAccentBgColor: (color: RgbaColor) => void
  setAppDestructiveBgColor: (color: RgbaColor) => void
  setThreadScrollBehavior: (value: ThreadScrollBehavior) => void
=======
import { useTheme } from './useTheme'

export type FontSize = '14px' | '15px' | '16px' | '18px' | '20px'

export const ACCENT_COLORS = [
  {
    name: 'Gray',
    value: 'gray',
    thumb: '#3F3F46',
    primary: '#f17455',
    sidebar: { light: '#f1f1f1', dark: '#171717' },
  },
  {
    name: 'Red',
    value: 'red',
    thumb: '#F0614B',
    primary: '#F0614B',
    sidebar: { light: '#F3CBC4', dark: '#5E1308' },
  },
  {
    name: 'Orange',
    value: 'orange',
    thumb: '#E9A23F',
    primary: '#E9A23F',
    sidebar: { light: '#F3DFC4', dark: '#5C3A0A' },
  },
  {
    name: 'Green',
    value: 'green',
    thumb: '#88BA42',
    primary: '#88BA42',
    sidebar: { light: '#DFF3C4', dark: '#374B1B' },
  },
  {
    name: 'Emerald',
    value: 'emerald',
    thumb: '#38AB51',
    primary: '#38AB51',
    sidebar: { light: '#C4F3CE', dark: '#194D24' },
  },
  {
    name: 'Teal',
    value: 'teal',
    thumb: '#38AB8D',
    primary: '#38AB8D',
    sidebar: { light: '#C4F3E6', dark: '#194D3F' },
  },
  {
    name: 'Cyan',
    value: 'cyan',
    thumb: '#45BBDE',
    primary: '#45BBDE',
    sidebar: { light: '#C4E8F3', dark: '#0F4657' },
  },
  {
    name: 'Blue',
    value: 'blue',
    thumb: '#456BDE',
    primary: '#456BDE',
    sidebar: { light: '#C4D0F3', dark: '#0F2157' },
  },
  {
    name: 'Purple',
    value: 'purple',
    thumb: '#865EEA',
    primary: '#865EEA',
    sidebar: { light: '#D2C4F3', dark: '#220C5A' },
  },
  {
    name: 'Pink',
    value: 'pink',
    thumb: '#D55EF3',
    primary: '#D55EF3',
    sidebar: { light: '#FFDAE9', dark: '#4D075F' },
  },
  {
    name: 'Rose',
    value: 'rose',
    thumb: '#F655B8',
    primary: '#F655B8',
    sidebar: { light: '#F3C4E1', dark: '#61053E' },
  },
] as const

export type AccentColorValue = (typeof ACCENT_COLORS)[number]['value']
const DEFAULT_ACCENT_COLOR: AccentColorValue = 'gray'

const applyAccentColorToDOM = (colorValue: string, isDark: boolean) => {
  const color = ACCENT_COLORS.find((c) => c.value === colorValue)
  if (!color) return

  const root = document.documentElement
  const sidebarColor = isDark ? color.sidebar.dark : color.sidebar.light

  root.style.setProperty('--sidebar', sidebarColor)
  root.style.setProperty('--primary', color.primary)
}

interface InterfaceSettingsState {
  fontSize: FontSize
  accentColor: AccentColorValue
  setFontSize: (size: FontSize) => void
  setAccentColor: (color: AccentColorValue) => void
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  resetInterface: () => void
}

type InterfaceSettingsPersistedSlice = Omit<
  InterfaceSettingsState,
<<<<<<< HEAD
  | 'resetInterface'
  | 'setChatWidth'
  | 'setFontSize'
  | 'setAppBgColor'
  | 'setAppMainViewBgColor'
  | 'setAppPrimaryBgColor'
  | 'setAppAccentBgColor'
  | 'setAppDestructiveBgColor'
  | 'setThreadScrollBehavior'
>

const getBrightness = ({ r, g, b }: RgbaColor) =>
  (r * 299 + g * 587 + b * 114) / 1000

export const fontSizeOptions = [
  { label: 'Small', value: '14px' as FontSize },
  { label: 'Medium', value: '15px' as FontSize },
  { label: 'Large', value: '16px' as FontSize },
  { label: 'Extra Large', value: '18px' as FontSize },
]

// Helper to determine if blur effects are supported
// This will be dynamically checked on Windows and Linux
let blurEffectsSupported = true
if ((IS_WINDOWS || IS_LINUX) && IS_TAURI) {
  // Default to false for Windows/Linux, will be checked async
  blurEffectsSupported = false
}

// Helper to get the appropriate alpha value
const getAlphaValue = () => {
  // Web always uses alpha = 1
  if (!IS_TAURI) return 1
  // Windows/Linux use 1 if blur not supported, 0.4 if supported
  if ((IS_WINDOWS || IS_LINUX) && !blurEffectsSupported) return 1
  // macOS and Windows/Linux with blur support use 0.4
  return 0.4
}

// Default interface settings
const defaultFontSize: FontSize = '15px'
const defaultAppBgColor: RgbaColor = {
  r: 25,
  g: 25,
  b: 25,
  a: getAlphaValue(),
}
const defaultLightAppBgColor: RgbaColor = {
  r: 255,
  g: 255,
  b: 255,
  a: getAlphaValue(),
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
  // Check if RGB matches default (ignore alpha since it changes based on blur support)
  const isDarkDefault = color.r === 25 && color.g === 25 && color.b === 25
  const isLightDefault = color.r === 255 && color.g === 255 && color.b === 255

  // Consider it default if RGB matches and alpha is either 0.4 or 1 (common values)
  const hasDefaultAlpha =
    Math.abs(color.a - 0.4) < 0.01 || Math.abs(color.a - 1) < 0.01

  return (isDarkDefault || isLightDefault) && hasDefaultAlpha
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

const getIsDarkTheme = (): boolean => {
  try {
    return !!useTheme.getState().isDark
  } catch {
    return false
  }
}

const copyColor = (color: RgbaColor): RgbaColor => ({
  r: color.r,
  g: color.g,
  b: color.b,
  a: color.a,
})

const createDefaultInterfaceValues = (): InterfaceSettingsPersistedSlice => {
  const isDark = getIsDarkTheme()
  const defaultTextColor = getDefaultTextColor(isDark)

  return {
    chatWidth: 'compact',
    fontSize: defaultFontSize,
    appBgColor: copyColor(defaultAppBgColor),
    appMainViewBgColor: copyColor(defaultAppMainViewBgColor),
    appPrimaryBgColor: copyColor(defaultAppPrimaryBgColor),
    appAccentBgColor: copyColor(defaultAppAccentBgColor),
    appDestructiveBgColor: copyColor(defaultAppDestructiveBgColor),
    appLeftPanelTextColor: defaultTextColor,
    appMainViewTextColor: defaultTextColor,
    appPrimaryTextColor: defaultTextColor,
    appAccentTextColor: defaultTextColor,
    appDestructiveTextColor: '#FFF',
    threadScrollBehavior: DEFAULT_THREAD_SCROLL_BEHAVIOR,
=======
  'resetInterface' | 'setFontSize' | 'setAccentColor'
>

export const fontSizeOptions = [
  { label: 'Small', value: '14px' as FontSize },
  { label: 'Medium', value: '16px' as FontSize },
  { label: 'Large', value: '18px' as FontSize },
  { label: 'Extra Large', value: '20px' as FontSize },
]

// Default interface settings
const defaultFontSize: FontSize = '16px'

const createDefaultInterfaceValues = (): InterfaceSettingsPersistedSlice => {
  return {
    fontSize: defaultFontSize,
    accentColor: DEFAULT_ACCENT_COLOR,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  }
}

const interfaceStorage = createJSONStorage<InterfaceSettingsState>(() =>
  localStorage
)

<<<<<<< HEAD
// Hook to check if alpha slider should be shown
export const useBlurSupport = () => {
  const [supportsBlur, setSupportsBlur] = useState(
    IS_MACOS && IS_TAURI // Default to true only for macOS
  )

  useEffect(() => {
    const checkBlurSupport = async () => {
      if ((IS_WINDOWS || IS_LINUX) && IS_TAURI) {
        try {
          // Get hardware info to check OS version
          const hardwareInfo = await getServiceHub()
            .hardware()
            .getHardwareInfo()
          const supported = supportsBlurEffects(hardwareInfo)

          blurEffectsSupported = supported
          setSupportsBlur(supported)

          const platform = IS_WINDOWS ? 'Windows' : 'Linux'
          if (supported) {
            console.log(
              `✅ ${platform} blur effects: SUPPORTED - Alpha slider will be shown`
            )
          } else {
            console.log(
              `❌ ${platform} blur effects: NOT SUPPORTED - Alpha slider will be hidden, alpha set to 1`
            )
          }
        } catch (error) {
          console.error(
            `❌ Failed to check ${IS_WINDOWS ? 'Windows' : 'Linux'} blur support:`,
            error
          )
          setSupportsBlur(false)
        }
      } else if (IS_MACOS && IS_TAURI) {
        console.log(
          '🍎 macOS platform: Blur effects supported, alpha slider shown'
        )
      } else if (!IS_TAURI) {
        console.log('🌐 Web platform: Alpha slider hidden, alpha set to 1')
      }
    }

    checkBlurSupport()
  }, [])

  // Return true if alpha slider should be shown
  // Show on macOS (always), and conditionally on Windows/Linux based on detection
  return IS_TAURI && (IS_MACOS || supportsBlur)
}

=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
export const useInterfaceSettings = create<InterfaceSettingsState>()(
  persist(
    (set) => {
      const defaultState = createDefaultInterfaceValues()
      return {
        ...defaultState,
        resetInterface: () => {
          const { isDark } = useTheme.getState()

          // Reset font size
          document.documentElement.style.setProperty(
            '--font-size-base',
            defaultFontSize
          )

<<<<<<< HEAD
          // Reset app background color with correct alpha based on blur support
          const currentAlpha = blurEffectsSupported && IS_TAURI ? 0.4 : 1
          const defaultBg = isDark
            ? { r: 25, g: 25, b: 25, a: currentAlpha }
            : { r: 255, g: 255, b: 255, a: currentAlpha }
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
          threadScrollBehavior: DEFAULT_THREAD_SCROLL_BEHAVIOR,
        })
      },

        setThreadScrollBehavior: (value: ThreadScrollBehavior) =>
          set({
            threadScrollBehavior: isThreadScrollBehavior(value)
              ? value
              : DEFAULT_THREAD_SCROLL_BEHAVIOR,
          }),

        setChatWidth: (value: ChatWidth) => {
          set({ chatWidth: value })
=======
          // Reset accent color preset
          applyAccentColorToDOM(DEFAULT_ACCENT_COLOR, isDark)

          // Update state
          set({
            fontSize: defaultFontSize,
            accentColor: DEFAULT_ACCENT_COLOR,
          })
        },

        setAccentColor: (color: AccentColorValue) => {
          const colorExists = ACCENT_COLORS.find((c) => c.value === color)
          if (!colorExists) return

          const { isDark } = useTheme.getState()
          applyAccentColorToDOM(color, isDark)
          set({ accentColor: color })
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        },

        setFontSize: (size: FontSize) => {
          // Update CSS variable
          document.documentElement.style.setProperty('--font-size-base', size)
          // Update state
          set({ fontSize: size })
        },
<<<<<<< HEAD

        setAppBgColor: (color: RgbaColor) => {
          // Get the current theme state
          const { isDark } = useTheme.getState()

          // If color is being set to default, use theme-appropriate default
          let finalColor = color
          if (isDefaultColor(color)) {
            finalColor = isDark ? defaultAppBgColor : defaultLightAppBgColor
          }

          // Force alpha to 1 if blur effects are not supported
          if (!blurEffectsSupported && (IS_WINDOWS || IS_LINUX || !IS_TAURI)) {
            finalColor = { ...finalColor, a: 1 }
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
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      }
    },
    {
      name: localStorageKey.settingInterface,
      storage: interfaceStorage,
      // Apply settings when hydrating from storage
      onRehydrateStorage: () => (state) => {
        if (state) {
<<<<<<< HEAD
          if (!isThreadScrollBehavior(state.threadScrollBehavior)) {
            state.threadScrollBehavior = DEFAULT_THREAD_SCROLL_BEHAVIOR
=======
          // Migrate old font size value '15px' to '16px'
          if ((state.fontSize as FontSize) === '15px') {
            state.fontSize = '16px'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          }

          // Apply font size from storage
          document.documentElement.style.setProperty(
            '--font-size-base',
            state.fontSize
          )

          // Get the current theme state
          const { isDark } = useTheme.getState()

<<<<<<< HEAD
          // Just use the stored color as-is during rehydration
          // The InterfaceProvider will handle alpha normalization after blur detection
          const finalColor = state.appBgColor

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
=======
          // Apply accent color preset
          const accentColorValue = state.accentColor || DEFAULT_ACCENT_COLOR
          applyAccentColorToDOM(accentColorValue, isDark)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        }

        // Return the state to be used for hydration
        return state
      },
    }
  )
)
<<<<<<< HEAD
=======

// Subscribe to theme changes to update accent color sidebar variant
let prevIsDark = useTheme.getState().isDark
useTheme.subscribe((state) => {
  if (state.isDark !== prevIsDark) {
    prevIsDark = state.isDark
    const { accentColor } = useInterfaceSettings.getState()
    applyAccentColorToDOM(accentColor, state.isDark)
  }
})
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
