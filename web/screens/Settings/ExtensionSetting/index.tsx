import React, { Fragment, useEffect, useState } from 'react'

import {
  BaseExtension,
  InstallationState,
  SettingComponentProps,
  InstallationPackage,
} from '@janhq/core'

import { useAtomValue, useSetAtom } from 'jotai'

import { loadingModalInfoAtom } from '@/containers/LoadingModal'

import ExtensionItem from '../CoreExtensions/ExtensionItem'
import ExtensionPackage from '../ExtensionPackage'
import SettingDetailItem from '../SettingDetail/SettingDetailItem'

import { extensionManager } from '@/extension'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const ExtensionSetting = () => {
  const selectedExtensionName = useAtomValue(selectedSettingAtom)
  const [settings, setSettings] = useState<SettingComponentProps[]>([])
  const setLoadingInfo = useSetAtom(loadingModalInfoAtom)
  const [installationState, setInstallationState] =
    useState<InstallationState>('NotRequired')
  const [installationPackages, setInstallationPackages] = useState<
    InstallationPackage[]
  >([])
  useState<InstallationState>('NotRequired')
  const [baseExtension, setBaseExtension] = useState<BaseExtension | undefined>(
    undefined
  )

  useEffect(() => {
    const getExtensionSettings = async () => {
      if (!selectedExtensionName) return
      const allSettings: SettingComponentProps[] = []
      const baseExtension = extensionManager.getByName(selectedExtensionName)
      if (!baseExtension) return

      setBaseExtension(baseExtension)
      if (typeof baseExtension.getSettings === 'function') {
        const setting = await baseExtension.getSettings()
        if (setting) allSettings.push(...setting)
      }
      setSettings(allSettings)

      setInstallationState(await baseExtension.installationState())
      setInstallationPackages(await baseExtension.installationPackages())
    }
    getExtensionSettings()
  }, [selectedExtensionName])

  const onValueChanged = async (
    key: string,
    value: string | number | boolean
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

  const onSettingUpdated = async (
    key: string,
    updatedSettings: SettingComponentProps
  ) => {
    const newSettings = await Promise.all(
      settings.map(async (setting) => {
        if (setting.key !== key) return setting
        setting = updatedSettings
        const extensionName = setting.extensionName
        if (extensionName) {
          await extensionManager
            .getByName(extensionName)
            ?.updateSettings([setting])
        }
        return setting
      })
    )
    setSettings(newSettings)
  }

  return (
    <Fragment>
      {settings.length > 0 && (
        <SettingDetailItem
          componentProps={settings}
          onValueUpdated={onValueChanged}
          onSettingUpdated={onSettingUpdated}
        />
      )}
      {baseExtension && installationState !== 'NotRequired' && (
        <ExtensionItem item={baseExtension} />
      )}
      {baseExtension &&
        installationPackages.length > 0 &&
        installationPackages.map((installationPackage) => (
          <ExtensionPackage
            key={installationPackage.name}
            item={baseExtension}
            installationPackage={installationPackage}
          />
        ))}
    </Fragment>
  )
}

export default ExtensionSetting
