import React, { Fragment, useState } from 'react'
import ToggleSwitch from '../ToggleSwitch'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline'
import CutomBotTemperature from '../CustomBotTemperature'
import DraggableProgressBar from '../DraggableProgressBar'

type Props = {
  control?: any
}

const CreateBotInAdvance: React.FC<Props> = ({ control }) => {
  const [showAdvanced, setShowAdvanced] = useState(true)

  const handleShowAdvanced = (e: React.MouseEvent<HTMLButtonElement>) => {
    setShowAdvanced(!showAdvanced)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start">
        <button
          className="mb-2 flex items-center justify-center font-bold"
          onClick={handleShowAdvanced}
        >
          Advanced
          {showAdvanced ? (
            <ChevronDownIcon width={16} className="ml-2" />
          ) : (
            <ChevronUpIcon width={16} className="ml-2" />
          )}
        </button>
      </div>

      {showAdvanced && (
        <>
          <div>
            <p className="text-bold">Max tokens</p>
            <DraggableProgressBar
              id="maxTokens"
              control={control}
              min={0}
              max={4096}
              step={1}
            />
          </div>
          <div>
            <p className="text-bold">Custom temperature</p>
            <DraggableProgressBar
              id="customTemperature"
              control={control}
              min={0}
              max={1}
              step={0.01}
            />
          </div>
          <div>
            <p className="text-bold">Frequency penalty</p>
            <DraggableProgressBar
              id="frequencyPenalty"
              control={control}
              min={0}
              max={1}
              step={0.01}
            />
          </div>
          <div>
            <p className="text-bold">Presence penalty</p>
            <DraggableProgressBar
              id="presencePenalty"
              control={control}
              min={0}
              max={1}
              step={0.01}
            />
          </div>
        </>
      )}

      {/* {showAdvanced && (
        <Fragment>
          <ToggleSwitch
            id="suggestReplies"
            title="Suggest replies"
            control={control}
          />
          <ToggleSwitch
            id="renderMarkdownContent"
            title="Render markdown content"
            control={control}
          />
          <CutomBotTemperature control={control} />
        </Fragment>
      )} */}
    </div>
  )
}

export default CreateBotInAdvance
