import React, { Children } from 'react'

type Props = {
  pluginName: string
}

import { formatPluginsName } from '@utils/converter'

const PreferencePlugins = (props: Props) => {
  const { pluginName } = props
  return (
    <div>
      <h6 className="text-sm font-semibold capitalize">
        {formatPluginsName(pluginName)}
      </h6>
    </div>
  )
}

export default PreferencePlugins
