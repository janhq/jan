import React, { Fragment, useEffect, useMemo, useState } from 'react'

import { SettingComponentProps } from '@janhq/core'

import { useAtomValue } from 'jotai'

import SettingDetailItem from '../SettingDetail/SettingDetailItem'

import { extensionManager } from '@/extension'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const ExtensionSetting = ({ extensionName }: { extensionName?: string }) => {
  const selectedExtensionName = useAtomValue(selectedSettingAtom)
  const [settings, setSettings] = useState<SettingComponentProps[]>([])

  const currentExtensionName = useMemo(
    () => extensionName ?? selectedExtensionName,
    [selectedExtensionName, extensionName]
  )

  useEffect(() => {
    const getExtensionSettings = async () => {
      if (!currentExtensionName) return
      const allSettings: SettingComponentProps[] = []
      const baseExtension = extensionManager.getByName(currentExtensionName)
      if (!baseExtension) return

      if (typeof baseExtension.getSettings === 'function') {
        const setting = await baseExtension.getSettings()
        if (setting) allSettings.push(...setting)
      }
      setSettings(allSettings)
    }
    getExtensionSettings()
  }, [currentExtensionName])

  const onValueChanged = async (
    key: string,
    value: string | number | boolean | string[]
  ) => {
    // find the key in settings state, update it and set the state back
    const newSettings = settings.map((setting) => {
      if (setting.key !== key) return setting
      setting.controllerProps.value = value

      const extensionName = setting.extensionName
      if (extensionName) {
        extensionManager.getByName(extensionName)?.updateSettings([setting])
      }

      return setting
    })

    setSettings(newSettings)
  }

  return (
    <Fragment>
      {settings.length > 0 && (
        <SettingDetailItem
          componentProps={settings}
          onValueUpdated={onValueChanged}
        />
      )}
    </Fragment>
  )
}

export default ExtensionSetting
