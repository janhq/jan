import { useCallback, useEffect } from 'react'

import { fs, joinPath } from '@janhq/core'

import { useAtomValue, useSetAtom } from 'jotai'

import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'
import {
  janThemesPathAtom,
  themesOptionsAtom,
} from '@/helpers/atoms/Setting.atom'

export const useLoadTheme = async () => {
  const janDataFolderPath = useAtomValue(janDataFolderPathAtom)
  const setThemeOptions = useSetAtom(themesOptionsAtom)
  const setThemePath = useSetAtom(janThemesPathAtom)

  const getThemes = useCallback(async () => {
    const folderPath = await joinPath([janDataFolderPath, 'themes'])
    const installedThemes = await fs.readdirSync(folderPath)

    if (janDataFolderPath.length > 0) {
      setThemePath(folderPath)
    }

    const a: { name: string; value: string }[] = installedThemes
      .filter((x: string) => x !== '.DS_Store')
      .map(async (x: string) => {
        const y = await joinPath([`${folderPath}/${x}`, `theme.json`])
        const c: Theme = JSON.parse(await fs.readFileSync(y, 'utf-8'))
        return { name: c?.displayName, value: c.id }
      })
    //
    Promise.all(a).then((results) => {
      setThemeOptions(results)
    })
  }, [janDataFolderPath, setThemeOptions, setThemePath])

  useEffect(() => {
    getThemes()
  }, [getThemes])
}
