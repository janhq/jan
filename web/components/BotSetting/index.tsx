import React, { useState } from 'react'

import { useAtomValue } from 'jotai'
import { useDebouncedCallback } from 'use-debounce'

import useUpdateBot from '@/hooks/useUpdateBot'

import { formatTwoDigits } from '@/utils/converter'

import ExpandableHeader from '../ExpandableHeader'

import { activeBotAtom } from '@/helpers/atoms/Bot.atom'

const delayBeforeUpdateInMs = 1000

const BotSetting: React.FC = () => {
  const activeBot = useAtomValue(activeBotAtom)
  const [temperature, setTemperature] = useState(
    activeBot?.customTemperature ?? 0
  )

  const [maxTokens, setMaxTokens] = useState(activeBot?.maxTokens ?? 0)
  const [frequencyPenalty, setFrequencyPenalty] = useState(
    activeBot?.frequencyPenalty ?? 0
  )
  const [presencePenalty, setPresencePenalty] = useState(
    activeBot?.presencePenalty ?? 0
  )

  const { updateBot } = useUpdateBot()

  const debouncedTemperature = useDebouncedCallback((value) => {
    if (!activeBot) return
    if (activeBot.customTemperature === value) return
    updateBot(activeBot, { customTemperature: value })
  }, delayBeforeUpdateInMs)

  const debouncedMaxToken = useDebouncedCallback((value) => {
    if (!activeBot) return
    if (activeBot.maxTokens === value) return
    updateBot(activeBot, { maxTokens: value })
  }, delayBeforeUpdateInMs)

  const debouncedFreqPenalty = useDebouncedCallback((value) => {
    if (!activeBot) return
    if (activeBot.frequencyPenalty === value) return
    updateBot(activeBot, { frequencyPenalty: value })
  }, delayBeforeUpdateInMs)

  const debouncedPresencePenalty = useDebouncedCallback((value) => {
    if (!activeBot) return
    if (activeBot.presencePenalty === value) return
    updateBot(activeBot, { presencePenalty: value })
  }, delayBeforeUpdateInMs)

  const debouncedSystemPrompt = useDebouncedCallback((value) => {
    if (!activeBot) return
    if (activeBot.systemPrompt === value) return
    updateBot(activeBot, { systemPrompt: value })
  }, delayBeforeUpdateInMs)

  if (!activeBot) return null

  return (
    <div className="my-3 flex flex-col">
      <ExpandableHeader title="BOT SETTINGS" />
      <div className="mx-2 mt-3 flex flex-shrink-0 flex-col gap-4">
        {/* System prompt */}
        <div>
          <label htmlFor="comment" className="block">
            System prompt
          </label>
          <div className="mt-1">
            <textarea
              rows={4}
              name="comment"
              id="comment"
              className="text-background-reverse placeholder:text-muted-foreground focus:ring-accent/50 block w-full resize-none rounded-md border-0 bg-background/80 py-1.5 text-xs leading-relaxed shadow-sm ring-1 ring-inset ring-border focus:ring-2 focus:ring-inset"
              defaultValue={activeBot.systemPrompt}
              onChange={(e) => debouncedSystemPrompt(e.target.value)}
            />
          </div>
        </div>

        {/* TODO: clean up this code */}
        {/* Max temp */}
        <p>Max tokens</p>
        <div className="mt-2 flex items-center gap-2">
          <input
            className="flex-1"
            type="range"
            defaultValue={activeBot.maxTokens ?? 0}
            min={0}
            max={4096}
            step={1}
            onChange={(e) => {
              const value = Number(e.target.value)
              setMaxTokens(value)
              debouncedMaxToken(value)
            }}
          />
          <span className="border-accent rounded-md border px-2 py-1">
            {formatTwoDigits(maxTokens)}
          </span>
        </div>

        <p>Frequency penalty</p>
        <div className="mt-2 flex items-center gap-2">
          <input
            className="flex-1"
            type="range"
            defaultValue={activeBot.frequencyPenalty ?? 0}
            min={0}
            max={1}
            step={0.01}
            onChange={(e) => {
              const value = Number(e.target.value)
              setFrequencyPenalty(value)
              debouncedFreqPenalty(value)
            }}
          />
          <span className="border-accent rounded-md border px-2 py-1">
            {formatTwoDigits(frequencyPenalty)}
          </span>
        </div>

        <p>Presence penalty</p>
        <div className="mt-2 flex items-center gap-2">
          <input
            className="flex-1"
            type="range"
            defaultValue={activeBot.maxTokens ?? 0}
            min={0}
            max={1}
            step={0.01}
            onChange={(e) => {
              const value = Number(e.target.value)
              setPresencePenalty(value)
              debouncedPresencePenalty(value)
            }}
          />
          <span className="border-accent rounded-md border px-2 py-1">
            {formatTwoDigits(presencePenalty)}
          </span>
        </div>

        {/* Custom temp */}
        <p>Temperature</p>
        <div className="mt-2 flex items-center gap-2">
          <input
            className="flex-1"
            type="range"
            id="volume"
            name="volume"
            defaultValue={activeBot.customTemperature ?? 0}
            min="0"
            max="1"
            step="0.01"
            onChange={(e) => {
              const newTemp = Number(e.target.value)
              setTemperature(newTemp)
              debouncedTemperature(Number(e.target.value))
            }}
          />
          <span className="border-accent rounded-md border px-2 py-1">
            {formatTwoDigits(temperature)}
          </span>
        </div>
      </div>
    </div>
  )
}

export default BotSetting
