'use client'

import React, { useContext } from 'react'
import { Switch } from '@uikit'
import {
  FeatureToggleContext,
} from '@helpers/FeatureToggleWrapper'

const Advanced = () => {
  const { experimentalFeatureEnabed, setExperimentalFeatureEnabled } = useContext(FeatureToggleContext)

  return (
    <div className="block w-full">
      <div className="flex w-full items-start justify-between border-b border-gray-200 py-4 first:pt-0 last:border-none dark:border-gray-800">
        <div className="w-4/5 flex-shrink-0 space-y-1.5">
          <div className="flex gap-x-2">
            <h6 className="text-sm font-semibold capitalize">
              Experimental Mode
            </h6>
          </div>
          <p className="whitespace-pre-wrap leading-relaxed text-gray-600 dark:text-gray-400">
            Enable experimental features that may be unstable or not fully
            tested.
          </p>
        </div>
        <Switch
          checked={experimentalFeatureEnabed}
          onCheckedChange={(e) => {
            if (e === true) {
              setExperimentalFeatureEnabled(true)
            } else {
              setExperimentalFeatureEnabled(false)
            }
          }}
        />
      </div>
    </div>
  )
}

export default Advanced
