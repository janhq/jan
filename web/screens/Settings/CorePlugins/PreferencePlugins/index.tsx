import React, { Children } from 'react'

type Props = {
  pluginName: string
  preferenceValues: any
}

import { formatPluginsName } from '@utils/converter'

const PreferencePlugins = (props: Props) => {
  const { pluginName, preferenceValues } = props

  console.log(preferenceValues)
  return (
    <div>
      <h6 className="text-sm font-semibold capitalize">
        {formatPluginsName(pluginName)}
      </h6>
    </div>
  )
}

export default PreferencePlugins
