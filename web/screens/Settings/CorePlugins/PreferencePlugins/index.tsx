import React from 'react'
import { execute } from '@plugin/extension-manager'

type Props = {
  pluginName: string
  preferenceValues: any
  preferenceItems: any
}

import { formatPluginsName } from '@utils/converter'
import { PluginService, preferences } from '@janhq/core'

const PreferencePlugins = (props: Props) => {
  const { pluginName, preferenceValues, preferenceItems } = props

  /**
   * Notifies plugins of a preference update by executing the `PluginService.OnPreferencesUpdate` event.
   * If a timeout is already set, it is cleared before setting a new timeout to execute the event.
   */
  let timeout: any | undefined = undefined
  function notifyPreferenceUpdate() {
    if (timeout) {
      clearTimeout(timeout)
    }
    timeout = setTimeout(
      () => execute(PluginService.OnPreferencesUpdate, {}),
      100
    )
  }

  return (
    <div>
      <h6 className="mb-6 text-sm font-semibold capitalize">
        {formatPluginsName(pluginName)}
      </h6>

      {preferenceItems
        .filter((x: any) => x.pluginName === pluginName)
        ?.map((e: any) => (
          <div key={e.preferenceKey} className="mb-4 flex flex-col">
            <div className="space-y-2">
              <span className="">Setting:</span>
              <span className="">{e.preferenceName}</span>
            </div>
            <span className="mt-1 text-muted-foreground">
              {e.preferenceDescription}
            </span>
            <div className="mt-2 flex flex-row items-center space-x-4">
              <input
                className="block w-full rounded-md border-0 bg-background/80 py-1.5 text-xs shadow-sm ring-1 ring-inset ring-border placeholder:text-muted-foreground focus:ring-2 focus:ring-inset focus:ring-accent/50 sm:leading-6"
                defaultValue={
                  preferenceValues.filter(
                    (v: any) => v.key === e.preferenceKey
                  )[0]?.value
                }
                onChange={(event) => {
                  preferences
                    .set(e.pluginName, e.preferenceKey, event.target.value)
                    .then(() => notifyPreferenceUpdate())
                }}
              ></input>
            </div>
          </div>
        ))}
    </div>
  )
}

export default PreferencePlugins
