import React, { Fragment } from 'react'

import { SettingComponentProps } from '@janhq/core/.'

import SettingComponentBuilder from './SettingComponent'

type Props = {
  componentProps: SettingComponentProps[]
}

const ModelSetting: React.FC<Props> = ({ componentProps }) => {
  return (
    <Fragment>
      {componentProps.filter((e) => e.key !== 'prompt_template').length && (
        <div className="flex flex-col">
          <SettingComponentBuilder
            componentProps={componentProps}
            selector={(e) => e.key !== 'prompt_template'}
          />
        </div>
      )}
    </Fragment>
  )
}

export default React.memo(ModelSetting)
