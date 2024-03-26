import React, { Fragment } from 'react'

import { SettingComponentProps } from '@janhq/core/.'

import SettingComponentBuilder from './SettingComponent'

type Props = {
  componentProps: SettingComponentProps[]
}

const ModelSetting: React.FC<Props> = ({ componentProps }) => (
  <Fragment>
    {componentProps.filter((e) => e.key !== 'prompt_template').length && (
      <SettingComponentBuilder componentProps={componentProps} />
    )}
  </Fragment>
)

export default React.memo(ModelSetting)
