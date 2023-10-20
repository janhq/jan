import ToggleSwitch from '../ToggleSwitch'
import DraggableProgressBar from '../DraggableProgressBar'
import { Controller } from 'react-hook-form'

type Props = {
  control?: any
}

const CutomBotTemperature: React.FC<Props> = ({ control }) => (
  <div className="flex flex-col gap-2">
    <ToggleSwitch
      id="enableCustomTemperature"
      title="Custom temperature"
      control={control}
    />
    <div className="mt-1 text-[0.8em] text-gray-500">
      Controls the creativity of the bot's responses. Higher values produce more
      varied but unpredictable replies, lower values generate more consistent
      responses.
    </div>
    <span className="text-gray-900">default: 0.7</span>
    <Controller
      name="enableCustomTemperature"
      control={control}
      render={({ field: { value } }) => {
        if (!value) return <div />
        return (
          <DraggableProgressBar
            id="customTemperature"
            control={control}
            min={0}
            max={1}
            step={0.01}
          />
        )
      }}
    />
  </div>
)

export default CutomBotTemperature
