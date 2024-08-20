import React, { Fragment, useEffect, useState } from 'react'

import {
  BaseExtension,
  InstallationState,
  SettingComponentProps,
  InstallationPackage,
} from '@janhq/core'

import { useAtomValue } from 'jotai'

import ExtensionItem from '../CoreExtensions/ExtensionItem'
import InstallStateIndicator from '../InstallStateIndicator'
import SettingDetailItem from '../SettingDetail/SettingDetailItem'

import { extensionManager } from '@/extension'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

const ExtensionSetting = () => {
  const selectedExtensionName = useAtomValue(selectedSettingAtom)
  const [settings, setSettings] = useState<SettingComponentProps[]>([])
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

  return (
    <Fragment>
      {settings.length > 0 && (
        <SettingDetailItem
          componentProps={settings}
          onValueUpdated={onValueChanged}
        />
      )}
      {baseExtension && installationState !== 'NotRequired' && (
        <ExtensionItem item={baseExtension} />
      )}
      {baseExtension &&
        installationPackages.length > 0 &&
        installationPackages.map((installationPackage) => (
          <div
            key={installationPackage.name}
            className="mx-4 flex items-start justify-between border-b border-[hsla(var(--app-border))] py-6 first:pt-4 last:border-none"
          >
            <div className="flex-1 flex-shrink-0 space-y-1">
              <div className="flex items-center gap-x-2">
                <h6 className="font-semibold">{installationPackage.name}</h6>
              </div>
              <div
                dangerouslySetInnerHTML={{
                  __html: installationPackage.description,
                }}
                className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]"
              />
            </div>

            <div className="flex min-w-[150px] flex-row justify-end">
              {/* TODO: Implement InstallStateIndicator properly */}
              <InstallStateIndicator
                installProgress={-1}
                installState={'NotInstalled'}
                onInstallClick={() =>
                  baseExtension.installPackage(installationPackage.name)
                }
                //TODO: onCancelClick
                onCancelClick={() => null}
              />
            </div>
          </div>
        ))}
    </Fragment>
  )
}

export default ExtensionSetting
