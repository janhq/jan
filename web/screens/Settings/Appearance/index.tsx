import { useCallback } from 'react'

import { useTheme } from 'next-themes'

import { fs, joinPath } from '@janhq/core'
import { Button, Select, Switch } from '@janhq/joi'
import { useAtom, useAtomValue } from 'jotai'

import {
  chatWidthAtom,
  janThemesPathAtom,
  reduceTransparentAtom,
  selectedThemeIdAtom,
  spellCheckAtom,
  themeDataAtom,
  themesOptionsAtom,
} from '@/helpers/atoms/Setting.atom'

export default function AppearanceOptions() {
  const [selectedIdTheme, setSelectedIdTheme] = useAtom(selectedThemeIdAtom)
  const themeOptions = useAtomValue(themesOptionsAtom)
  const { setTheme } = useTheme()
  const janThemesPath = useAtomValue(janThemesPathAtom)
  const [themeData, setThemeData] = useAtom(themeDataAtom)
  const [reduceTransparent, setReduceTransparent] = useAtom(
    reduceTransparentAtom
  )
  const [spellCheck, setSpellCheck] = useAtom(spellCheckAtom)
  const [chatWidth, setChatWidth] = useAtom(chatWidthAtom)

  const chatWidthOption = [
    { name: 'Full Width', value: 'full', img: 'images/full-width.png' },
    {
      name: 'Compact Width',
      value: 'compact',
      img: 'images/compact-width.png',
    },
  ]

  const handleClickTheme = useCallback(
    async (e: string) => {
      setSelectedIdTheme(e)
      const filePath = await joinPath([`${janThemesPath}/${e}`, `theme.json`])
      const theme: Theme = JSON.parse(await fs.readFileSync(filePath, 'utf-8'))
      setThemeData(theme)
      setTheme(String(theme?.nativeTheme))
      if (theme?.reduceTransparent) {
        setReduceTransparent(reduceTransparent)
      } else {
        setReduceTransparent(true)
      }
    },
    [
      janThemesPath,
      reduceTransparent,
      setReduceTransparent,
      setSelectedIdTheme,
      setTheme,
      setThemeData,
    ]
  )

  return (
    <div className="m-4 block">
      <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
        <div className="flex-shrink-0 space-y-1">
          <div className="flex gap-x-2">
            <h6 className="font-semibold capitalize">Appearance</h6>
          </div>
          <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
            Select a color theme.
          </p>
        </div>
        <Select
          value={selectedIdTheme}
          options={themeOptions}
          onValueChange={(e) => handleClickTheme(e)}
        />
      </div>
      {themeData?.reduceTransparent && (
        <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
          <div className="flex-shrink-0 space-y-1">
            <div className="flex gap-x-2">
              <h6 className="font-semibold capitalize">Interface theme</h6>
            </div>
          </div>
          <div className="flex items-center gap-x-2">
            <Button
              theme={reduceTransparent ? 'primary' : 'ghost'}
              variant={reduceTransparent ? 'solid' : 'outline'}
              onClick={() => setReduceTransparent(true)}
            >
              Solid
            </Button>
            <Button
              theme={reduceTransparent ? 'ghost' : 'primary'}
              variant={reduceTransparent ? 'outline' : 'solid'}
              onClick={() => setReduceTransparent(false)}
            >
              Translucent
            </Button>
          </div>
        </div>
      )}
      <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
        <div className="w-full space-y-1 lg:w-3/4">
          <div className="flex gap-x-2">
            <h6 className="font-semibold capitalize">Chat Width</h6>
          </div>
          <p className=" font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
            Choose the width of the chat area to customize your conversation
            view
          </p>
        </div>
        <div className="flex-shrink-0">
          <div className="flex items-center gap-4">
            {chatWidthOption.map((option) => {
              return (
                <div
                  className="inline-flex flex-col items-center justify-center text-center"
                  key={option.name}
                >
                  <label
                    className="relative cursor-pointer"
                    htmlFor={option.name}
                  >
                    <img
                      src={option.img}
                      alt={option.value}
                      width={140}
                      className="rounded-lg"
                    />
                    <p className="my-2 font-medium">{option.name}</p>
                    <div className="relative">
                      <input
                        name="chatWidth"
                        value={option.value}
                        checked={chatWidth === option.value}
                        onChange={() => setChatWidth(option.value)}
                        type="radio"
                        className="peer h-5 w-5 cursor-pointer appearance-none rounded-full border border-[hsla(var(--app-border))] transition-all checked:border-[hsla(var(--primary-bg))]"
                        id={option.name}
                      />
                      <span className="absolute left-1/2 top-1/2 -mt-[3px] h-3 w-3 -translate-x-1/2 -translate-y-1/2 transform rounded-full bg-[hsla(var(--primary-bg))] opacity-0 transition-opacity duration-200 peer-checked:opacity-100"></span>
                    </div>
                  </label>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
        <div className="w-full space-y-1 lg:w-3/4">
          <div className="flex gap-x-2">
            <h6 className="font-semibold capitalize">Spell Check</h6>
          </div>
          <p className=" font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
            Turn on to enable spell check
          </p>
        </div>
        <div className="flex-shrink-0">
          <Switch
            checked={spellCheck}
            onChange={(e) => setSpellCheck(e.target.checked)}
          />
        </div>
      </div>
    </div>
  )
}
