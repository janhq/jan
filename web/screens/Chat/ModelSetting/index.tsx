/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'

import SettingComponentBuilder, {
  SettingComponentData,
} from './SettingComponent'

const ModelSetting = ({
  componentData,
}: {
  componentData: SettingComponentData[]
}) => {
  return (
    <>
      {componentData.filter((e) => e.name !== 'prompt_template').length && (
        <div className="flex flex-col">
          <SettingComponentBuilder
            componentData={componentData}
            selector={(e) => e.name !== 'prompt_template'}
          />
        </div>
      )}
    </>
  )
}

export default React.memo(ModelSetting)
