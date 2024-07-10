import { useCallback, useEffect } from 'react'

import { useTheme } from 'next-themes'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import cssVars from '@/utils/jsonToCssVariables'

import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'
import {
  selectedThemeIdAtom,
  themeDataAtom,
  themesOptionsAtom,
} from '@/helpers/atoms/Setting.atom'

type NativeThemeProps = 'light' | 'dark'

export const useLoadTheme = async () => {
  const janDataFolderPath = useAtomValue(janDataFolderPathAtom)
  const setThemeOptions = useSetAtom(themesOptionsAtom)
  const [themeData, setThemeData] = useAtom(themeDataAtom)
  const [selectedIdTheme, setSelectedIdTheme] = useAtom(selectedThemeIdAtom)
  const { setTheme } = useTheme()

  const setNativeTheme = useCallback(
    (nativeTheme: NativeThemeProps) => {
      if (nativeTheme === 'dark') {
        window?.electronAPI?.setNativeThemeDark()
        setTheme('dark')
        localStorage.setItem('nativeTheme', 'dark')
      } else {
        window?.electronAPI?.setNativeThemeLight()
        setTheme('light')
        localStorage.setItem('nativeTheme', 'light')
      }
    },
    [setTheme]
  )

  const getThemes = useCallback(async () => {
    const themesOptions: { name: string; value: string }[] =
      await window.electronAPI?.getThemes()
    Promise.all(themesOptions).then((results) => {
      setThemeOptions(results)
    })

    if (!selectedIdTheme.length) return setSelectedIdTheme('joi-light')

    const theme: Theme = await window.electronAPI.readTheme(selectedIdTheme)

    setThemeData(theme)
    setNativeTheme(theme.nativeTheme)
    const variables = cssVars(theme.variables)
    const headTag = document.getElementsByTagName('head')[0]
    const styleTag = document.createElement('style')
    styleTag.innerHTML = `:root {${variables}}`
    headTag.appendChild(styleTag)
  }, [
    selectedIdTheme,
    setNativeTheme,
    setSelectedIdTheme,
    setThemeData,
    setThemeOptions,
  ])

  useEffect(() => {
    getThemes()
    setNativeTheme(themeData?.nativeTheme as NativeThemeProps)
  }, [
    getThemes,
    selectedIdTheme,
    setNativeTheme,
    setSelectedIdTheme,
    themeData?.nativeTheme,
  ])
}
