import SettingComponentBuilder from '../../Chat/ModelSetting/SettingComponent'
import { SettingComponentData } from '../ModelSetting/SettingComponent'

const EngineSetting = ({
  componentData,
  enabled = true,
}: {
  componentData: SettingComponentData[]
  enabled?: boolean
}) => {
  return (
    <>
      {componentData.filter((e) => e.name !== 'prompt_template').length && (
        <div className="flex flex-col">
          <SettingComponentBuilder
            componentData={componentData}
            enabled={enabled}
            selector={(e) => e.name !== 'prompt_template'}
          />
        </div>
      )}
    </>
  )
}

export default EngineSetting
