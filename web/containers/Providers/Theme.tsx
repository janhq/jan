'use client'
import React, { useCallback, useEffect } from 'react'

import { PropsWithChildren } from 'react'

import { ThemeProvider } from 'next-themes'

import { fs, joinPath } from '@janhq/core'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { useLoadTheme } from '@/hooks/useLoadTheme'

import cssVars from '@/utils/jsonToCssVariables'

import {
  selectedThemeIdAtom,
  themeDataAtom,
  janThemesPathAtom,
} from '@/helpers/atoms/Setting.atom'

export default function ThemeWrapper({ children }: PropsWithChildren) {
  const [selectedIdTheme, setSelectedIdTheme] = useAtom(selectedThemeIdAtom)
  const setThemeData = useSetAtom(themeDataAtom)
  const janThemesPath = useAtomValue(janThemesPathAtom)

  useLoadTheme()

  const setNativeTheme = useCallback((nativeTheme: 'light' | 'dark') => {
    if (nativeTheme === 'dark') {
      window?.electronAPI.setNativeThemeDark()
    } else {
      window?.electronAPI.setNativeThemeLight()
    }
  }, [])

  const getThemeData = useCallback(async () => {
    if (!janThemesPath) return
    if (!selectedIdTheme.length) return setSelectedIdTheme('joi-light')
    const filePath = await joinPath([
      `${janThemesPath}/${selectedIdTheme}`,
      `theme.json`,
    ])
    const theme: Theme = JSON.parse(await fs.readFileSync(filePath, 'utf-8'))
    setThemeData(theme)
    setNativeTheme(theme.nativeTheme)
    const variables = cssVars(theme.variables)
    const headTag = document.getElementsByTagName('head')[0]
    const styleTag = document.createElement('style')
    styleTag.innerHTML = `:root {${variables}}`
    headTag.appendChild(styleTag)
  }, [
    janThemesPath,
    selectedIdTheme,
    setNativeTheme,
    setSelectedIdTheme,
    setThemeData,
  ])

  useEffect(() => {
    getThemeData()
  }, [getThemeData, selectedIdTheme, setSelectedIdTheme])

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      storageKey="nativeTheme"
    >
      {children}
    </ThemeProvider>
  )
}
