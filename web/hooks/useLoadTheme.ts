import { useCallback, useEffect } from 'react'

import { useTheme } from 'next-themes'

import { fs, joinPath } from '@janhq/core'

import { useAtom, useAtomValue } from 'jotai'

import cssVars from '@/utils/jsonToCssVariables'

import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'
import {
  selectedThemeIdAtom,
  themeDataAtom,
  themesOptionsAtom,
} from '@/helpers/atoms/Setting.atom'

type NativeThemeProps = 'light' | 'dark'

export const useLoadTheme = () => {
  const janDataFolderPath = useAtomValue(janDataFolderPathAtom)
  const [themeOptions, setThemeOptions] = useAtom(themesOptionsAtom)
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

  const applyTheme = (theme: Theme) => {
    const variables = cssVars(theme.variables)
    const headTag = document.getElementsByTagName('head')[0]
    const styleTag = document.createElement('style')
    styleTag.innerHTML = `:root {${variables}}`
    headTag.appendChild(styleTag)
  }

  const getThemes = useCallback(async () => {
    if (!janDataFolderPath.length) return
    const folderPath = await joinPath([janDataFolderPath, 'themes'])
    const installedThemes = await fs.readdirSync(folderPath)

    const themesOptions: { name: string; value: string }[] = installedThemes
      .filter((x: string) => x !== '.DS_Store')
      .map(async (x: string) => {
        const y = await joinPath([`${folderPath}/${x}`, `theme.json`])
        const c: Theme = JSON.parse(await fs.readFileSync(y, 'utf-8'))
        return { name: c?.displayName, value: c.id }
      })
    Promise.all(themesOptions).then((results) => {
      setThemeOptions(results)
    })

    if (janDataFolderPath.length > 0) {
      if (!selectedIdTheme.length) return setSelectedIdTheme('joi-light')
      const filePath = await joinPath([
        `${folderPath}/${selectedIdTheme}`,
        `theme.json`,
      ])
      const theme: Theme = JSON.parse(await fs.readFileSync(filePath, 'utf-8'))

      setThemeData(theme)
      setNativeTheme(theme.nativeTheme)
      applyTheme(theme)
    }
  }, [
    janDataFolderPath,
    selectedIdTheme,
    setNativeTheme,
    setSelectedIdTheme,
    setThemeData,
    setThemeOptions,
  ])

  const configureTheme = useCallback(async () => {
    if (!themeData || !themeOptions) {
      await getThemes()
    } else {
      applyTheme(themeData)
    }
    setNativeTheme(themeData?.nativeTheme as NativeThemeProps)
  }, [themeData, themeOptions, getThemes, setNativeTheme])

  useEffect(() => {
    configureTheme()
  }, [
    configureTheme,
    selectedIdTheme,
    setNativeTheme,
    setSelectedIdTheme,
    themeData?.nativeTheme,
  ])
}
