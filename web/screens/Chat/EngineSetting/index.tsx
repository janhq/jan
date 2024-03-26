import { Fragment } from 'react'

import { SettingComponentProps } from '@janhq/core/.'

import SettingComponentBuilder from '../../Chat/ModelSetting/SettingComponent'

const EngineSetting = ({
  componentData,
  enabled = true,
}: {
  componentData: SettingComponentProps[]
  enabled?: boolean
}) => (
  <Fragment>
    {componentData.filter((e) => e.key !== 'prompt_template').length && (
      <SettingComponentBuilder
        componentProps={componentData}
        enabled={enabled}
      />
    )}
  </Fragment>
)

export default EngineSetting
