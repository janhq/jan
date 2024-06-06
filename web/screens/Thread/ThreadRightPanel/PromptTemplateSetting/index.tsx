import { useCallback } from 'react'

import { SettingComponentProps } from '@janhq/core'

import SettingComponent from '../../../../containers/ModelSetting/SettingComponent'

type Props = {
  componentData: SettingComponentProps[]
}

const PromptTemplateSetting: React.FC<Props> = ({ componentData }) => {
  // TODO: NamH will need to stop model
  // const { updateModelParameter } = useUpdateModelParameters()

  const onValueChanged = useCallback(
    (key: string, value: string | number | boolean) => {
      // TODO: NamH update assistant
      // if (!activeThread) return
      // stopModel(activeThread.assistants[0].model)
      // updateModelParameter(activeThread, {
      //   params: { [key]: value },
      // })
    },
    []
  )

  return (
    <SettingComponent
      componentProps={componentData}
      onValueUpdated={onValueChanged}
    />
  )
}

export default PromptTemplateSetting
