import { Fragment } from 'react'

import { SettingComponentProps } from '@janhq/core/.'

import SettingComponentBuilder from '../../Chat/ModelSetting/SettingComponent'

const EngineSetting = ({
  componentData,
  enabled = true,
}: {
  componentData: SettingComponentProps[]
  enabled?: boolean
}) => {
  return (
    <Fragment>
      {componentData.filter((e) => e.key !== 'prompt_template').length && (
        <div className="flex flex-col">
          <SettingComponentBuilder
            componentProps={componentData}
            enabled={enabled}
            selector={(e) => e.key !== 'prompt_template'}
          />
        </div>
      )}
    </Fragment>
  )
}

export default EngineSetting
