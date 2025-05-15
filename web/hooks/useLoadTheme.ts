import { useCallback, useEffect } from 'react'

import { useTheme } from 'next-themes'

import { useAtom } from 'jotai'

import cssVars from '@/utils/jsonToCssVariables'

import {
  selectedThemeIdAtom,
  themeDataAtom,
  themesOptionsAtom,
} from '@/helpers/atoms/Setting.atom'

type NativeThemeProps = 'light' | 'dark'

export const useLoadTheme = () => {
  const [themeOptions, setThemeOptions] = useAtom(themesOptionsAtom)
  const [themeData, setThemeData] = useAtom(themeDataAtom)
  const [selectedIdTheme, setSelectedIdTheme] = useAtom(selectedThemeIdAtom)
  const { setTheme } = useTheme()

  const setNativeTheme = useCallback(
    (nativeTheme: NativeThemeProps) => {
      if (!window.electronAPI) return

      if (nativeTheme === 'dark') {
        window?.core?.api?.setNativeThemeDark()
        setTheme('dark')
        localStorage.setItem('nativeTheme', 'dark')
      } else {
        window?.core?.api?.setNativeThemeLight()
        setTheme('light')
        localStorage.setItem('nativeTheme', 'light')
      }
    },
    [setTheme]
  )

  const applyTheme = (theme: Theme) => {
    if (!theme.variables) return
    const variables = cssVars(theme.variables)
    const headTag = document.getElementsByTagName('head')[0]
    const styleTag = document.createElement('style')
    styleTag.innerHTML = `:root {${variables}}`
    headTag.appendChild(styleTag)
  }

  const getThemes = useCallback(async () => {
    const installedThemes = await window.core.api.getThemes()

    const themesOptions: { name: string; value: string }[] =
      installedThemes.map((x: string) => ({
        name: x
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (char) => char.toUpperCase()),
        value: x,
      }))
    setThemeOptions(themesOptions)

    if (!selectedIdTheme.length) return setSelectedIdTheme('joi-light')
    const theme: Theme = JSON.parse(
      await window.core.api.readTheme({
        themeName: selectedIdTheme,
      })
    )

    setThemeData(theme)
    setNativeTheme(theme.nativeTheme)
    applyTheme(theme)
  }, [selectedIdTheme])

  const configureTheme = useCallback(async () => {
    if (!themeData || !themeOptions) {
      getThemes()
    } else {
      applyTheme(themeData)
    }
    setNativeTheme(themeData?.nativeTheme as NativeThemeProps)
  }, [themeData, themeOptions, getThemes, setNativeTheme])

  useEffect(() => {
    configureTheme()
  }, [themeData])

  useEffect(() => {
    getThemes()
  }, [])
}
