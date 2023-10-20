import { activeBotAtom } from "@/_helpers/atoms/Bot.atom";
import { useAtomValue } from "jotai";
import React, { useState } from "react";
import ExpandableHeader from "../ExpandableHeader";
import { useDebouncedCallback } from "use-debounce";
import useUpdateBot from "@/_hooks/useUpdateBot";
import { formatTwoDigits } from "@/_utils/converter";

const delayBeforeUpdateInMs = 1000;

const BotSetting: React.FC = () => {
  const activeBot = useAtomValue(activeBotAtom);
  const [temperature, setTemperature] = useState(
    activeBot?.customTemperature ?? 0
  );

  const [maxTokens, setMaxTokens] = useState(activeBot?.maxTokens ?? 0);
  const [frequencyPenalty, setFrequencyPenalty] = useState(
    activeBot?.frequencyPenalty ?? 0
  );
  const [presencePenalty, setPresencePenalty] = useState(
    activeBot?.presencePenalty ?? 0
  );

  const { updateBot } = useUpdateBot();

  const debouncedTemperature = useDebouncedCallback((value) => {
    if (!activeBot) return;
    if (activeBot.customTemperature === value) return;
    updateBot(activeBot, { customTemperature: value });
  }, delayBeforeUpdateInMs);

  const debouncedMaxToken = useDebouncedCallback((value) => {
    if (!activeBot) return;
    if (activeBot.maxTokens === value) return;
    updateBot(activeBot, { maxTokens: value });
  }, delayBeforeUpdateInMs);

  const debouncedFreqPenalty = useDebouncedCallback((value) => {
    if (!activeBot) return;
    if (activeBot.frequencyPenalty === value) return;
    updateBot(activeBot, { frequencyPenalty: value });
  }, delayBeforeUpdateInMs);

  const debouncedPresencePenalty = useDebouncedCallback((value) => {
    if (!activeBot) return;
    if (activeBot.presencePenalty === value) return;
    updateBot(activeBot, { presencePenalty: value });
  }, delayBeforeUpdateInMs);

  const debouncedSystemPrompt = useDebouncedCallback((value) => {
    if (!activeBot) return;
    if (activeBot.systemPrompt === value) return;
    updateBot(activeBot, { systemPrompt: value });
  }, delayBeforeUpdateInMs);

  if (!activeBot) return null;

  return (
    <div className="flex flex-col my-3">
      <ExpandableHeader
        title="BOT SETTINGS"
        expanded={true}
        onClick={() => {}}
      />

      <div className="flex flex-col mx-2 flex-shrink-0 gap-4 mt-3">
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

        {/* TODO: clean up this code */}
        {/* Max temp */}
        <p>Max tokens</p>
        <div className="flex items-center gap-2 mt-2">
          <input
            className="flex-1"
            type="range"
            defaultValue={activeBot.maxTokens ?? 0}
            min={0}
            max={4096}
            step={1}
            onChange={(e) => {
              const value = Number(e.target.value);
              setMaxTokens(value);
              debouncedMaxToken(value);
            }}
          />
          <span className="border border-[#737d7d] rounded-md py-1 px-2 text-gray-900">
            {formatTwoDigits(maxTokens)}
          </span>
        </div>

        <p>Frequency penalty</p>
        <div className="flex items-center gap-2 mt-2">
          <input
            className="flex-1"
            type="range"
            defaultValue={activeBot.frequencyPenalty ?? 0}
            min={0}
            max={1}
            step={0.01}
            onChange={(e) => {
              const value = Number(e.target.value);
              setFrequencyPenalty(value);
              debouncedFreqPenalty(value);
            }}
          />
          <span className="border border-[#737d7d] rounded-md py-1 px-2 text-gray-900">
            {formatTwoDigits(frequencyPenalty)}
          </span>
        </div>

        <p>Presence penalty</p>
        <div className="flex items-center gap-2 mt-2">
          <input
            className="flex-1"
            type="range"
            defaultValue={activeBot.maxTokens ?? 0}
            min={0}
            max={1}
            step={0.01}
            onChange={(e) => {
              const value = Number(e.target.value);
              setPresencePenalty(value);
              debouncedPresencePenalty(value);
            }}
          />
          <span className="border border-[#737d7d] rounded-md py-1 px-2 text-gray-900">
            {formatTwoDigits(presencePenalty)}
          </span>
        </div>

        {/* Custom temp */}
        <p>Temperature</p>
        <div className="flex items-center gap-2 mt-2">
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
              const newTemp = Number(e.target.value);
              setTemperature(newTemp);
              debouncedTemperature(Number(e.target.value));
            }}
          />
          <span className="border border-[#737d7d] rounded-md py-1 px-2 text-gray-900">
            {formatTwoDigits(temperature)}
          </span>
        </div>
      </div>
    </div>
  );
};

export default BotSetting;
