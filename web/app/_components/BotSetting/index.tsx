import { activeBotAtom } from '@/_helpers/atoms/Bot.atom'
import { useAtomValue } from 'jotai'
import React from 'react'
import ExpandableHeader from '../ExpandableHeader'
import { useDebouncedCallback } from 'use-debounce'
import useUpdateBot from '@/_hooks/useUpdateBot'
import { formatTwoDigits } from '@/_utils/converter'

const delayBeforeUpdateInMs = 1000

const BotSetting: React.FC = () => {
  const activeBot = useAtomValue(activeBotAtom)
  const { updateBot } = useUpdateBot()

  const debouncedTemperature = useDebouncedCallback((value) => {
    if (!activeBot) return
    if (activeBot.customTemperature === value) return
    updateBot(activeBot, { customTemperature: value })
  }, delayBeforeUpdateInMs)

  const debouncedSystemPrompt = useDebouncedCallback((value) => {
    if (!activeBot) return
    if (activeBot.systemPrompt === value) return
    updateBot(activeBot, { systemPrompt: value })
  }, delayBeforeUpdateInMs)

  if (!activeBot) return null

  return (
    <div className="my-3 flex flex-col">
      <ExpandableHeader
        title="BOT SETTINGS"
        expanded={true}
        onClick={() => {}}
      />

      <div className="mx-2 mt-3 flex flex-shrink-0 flex-col gap-4">
        {/* System prompt */}
        <div>
          <label
            htmlFor="comment"
            className="block text-sm font-medium leading-6 text-gray-900"
          >
            System prompt
          </label>
          <div className="mt-2">
            <textarea
              rows={4}
              name="comment"
              id="comment"
              className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
              defaultValue={activeBot.systemPrompt}
              onChange={(e) => debouncedSystemPrompt(e.target.value)}
            />
          </div>
        </div>

        {/* Custom temp */}
        <div className="mt-2 flex items-center gap-2">
          <input
            className="flex-1"
            type="range"
            id="volume"
            name="volume"
            min="0"
            max="1"
            step="0.01"
            onChange={(e) => debouncedTemperature(e.target.value)}
          />
          {/* <span className="border border-[#737d7d] rounded-md py-1 px-2 text-gray-900">
            {formatTwoDigits(value)}
          </span> */}
        </div>
      </div>
    </div>
  )
}

export default BotSetting
