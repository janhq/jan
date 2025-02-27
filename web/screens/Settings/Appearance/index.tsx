import { useCallback } from 'react'

import { useTheme } from 'next-themes'

import { fs, joinPath } from '@janhq/core'
import { Button, Select, Switch } from '@janhq/joi'
import { useAtom, useAtomValue } from 'jotai'

import { twMerge } from 'tailwind-merge'

import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'

import {
  chatWidthAtom,
  reduceTransparentAtom,
  selectedThemeIdAtom,
  showScrollBarAtom,
  spellCheckAtom,
  themeDataAtom,
  themesOptionsAtom,
} from '@/helpers/atoms/Setting.atom'

export default function AppearanceOptions() {
  const [selectedIdTheme, setSelectedIdTheme] = useAtom(selectedThemeIdAtom)
  const themeOptions = useAtomValue(themesOptionsAtom)
  const janDataFolderPath = useAtomValue(janDataFolderPathAtom)
  const { setTheme, theme } = useTheme()
  const [themeData, setThemeData] = useAtom(themeDataAtom)
  const [reduceTransparent, setReduceTransparent] = useAtom(
    reduceTransparentAtom
  )
  const [spellCheck, setSpellCheck] = useAtom(spellCheckAtom)
  const [showScrollBar, setShowScrollBar] = useAtom(showScrollBarAtom)
  const [chatWidth, setChatWidth] = useAtom(chatWidthAtom)

  const chatWidthOption = [
    {
      name: 'Full Width',
      value: 'full',
      img: 'images/full-width.png',
      darkImg: 'images/full-width-dark.png',
    },
    {
      name: 'Compact Width',
      value: 'compact',
      img: 'images/compact-width.png',
      darkImg: 'images/compact-width-dark.png',
    },
  ]

  const handleClickTheme = useCallback(
    async (e: string) => {
      setSelectedIdTheme(e)
      const janThemesPath = await joinPath([janDataFolderPath, 'themes'])
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
      janDataFolderPath,
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
          position="popper"
          sideOffset={4}
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
            view.
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
                    onClick={() => setChatWidth(option.value)}
                  >
                    <img
                      src={theme === 'dark' ? option.darkImg : option.img}
                      alt={option.value}
                      width={140}
                      className={twMerge(
                        'rounded-lg border-2 border-[hsla(var(--app-border))] bg-[hsla(var(--secondary-bg))] transition-all',
                        chatWidth === option.value &&
                          'border-[hsla(var(--primary-bg))]'
                      )}
                    />
                    <p className="my-2 font-medium">{option.name}</p>
                    {chatWidth === option.value && (
                      <div className="absolute right-2 top-2 ">
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 16 16"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <rect
                            width="16"
                            height="16"
                            rx="8"
                            className="fill-[hsla(var(--primary-bg))]"
                          />
                          <path
                            d="M11.1111 5.66699L6.83333 9.94477L4.88889 8.00033"
                            stroke="white"
                            strokeWidth="0.886667"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                    )}
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
            Turn on to enable spell check.
          </p>
        </div>
        <div className="flex-shrink-0">
          <Switch
            checked={spellCheck}
            onChange={(e) => setSpellCheck(e.target.checked)}
          />
        </div>
      </div>
      <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
        <div className="w-full space-y-1 lg:w-3/4">
          <div className="flex gap-x-2">
            <h6 className="font-semibold capitalize">Scrolling Bar</h6>
          </div>
          <p className=" font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
            Turn on to make scrolling bar visible across windows.
          </p>
        </div>
        <div className="flex-shrink-0">
          <Switch
            checked={showScrollBar}
            onChange={(e) => setShowScrollBar(e.target.checked)}
          />
        </div>
      </div>
    </div>
  )
}
