/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */

import React, { useState, useEffect, useRef, useContext } from 'react'

import { Switch, Button } from '@janhq/uikit'

import Loader from '@/containers/Loader'

import { FeatureToggleContext } from '@/context/FeatureToggle'
import { pluginManager } from '@plugin/PluginManager'

import { useGetAppVersion } from '@/hooks/useGetAppVersion'

import { formatPluginsName } from '@/utils/converter'

import { plugins, extensionPoints } from '@/plugin'

const PluginCatalog = () => {
  const [activePlugins, setActivePlugins] = useState<any[]>([])
  const [pluginCatalog, setPluginCatalog] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const experimentRef = useRef(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { version } = useGetAppVersion()
  const { experimentalFeatureEnabed } = useContext(FeatureToggleContext)
  /**
   * Loads the plugin catalog module from a CDN and sets it as the plugin catalog state.
   */
  useEffect(() => {
    if (!window.electronAPI) {
      return
    }
    if (!version) return

    // Get plugin manifest
    import(/* webpackIgnore: true */ PLUGIN_CATALOG + `?t=${Date.now()}`).then(
      (data) => {
        if (Array.isArray(data.default) && experimentalFeatureEnabed)
          setPluginCatalog(data.default)
      }
    )
  }, [experimentalFeatureEnabed, version])

  /**
   * Fetches the active plugins and their preferences from the `plugins` and `preferences` modules.
   * If the `experimentComponent` extension point is available, it executes the extension point and
   * appends the returned components to the `experimentRef` element.
   * If the `PluginPreferences` extension point is available, it executes the extension point and
   * fetches the preferences for each plugin using the `preferences.get` function.
   */
  useEffect(() => {
    const getActivePlugins = async () => {
      const plgs = await pluginManager.getActive()
      if (Array.isArray(plgs)) setActivePlugins(plgs)
    }
    getActivePlugins()
  }, [])

  /**
   * Installs a plugin by calling the `plugins.install` function with the plugin file path.
   * If the installation is successful, the application is relaunched using the `coreAPI.relaunch` function.
   * @param e - The event object.
   */
  const install = async (e: any) => {
    e.preventDefault()
    const pluginFile = e.target.files?.[0].path

    // Send the filename of the to be installed plugin
    // to the main process for installation
    const installed = await pluginManager.install([pluginFile])
    if (installed) window.coreAPI?.relaunch()
  }

  /**
   * Uninstalls a plugin by calling the `plugins.uninstall` function with the plugin name.
   * If the uninstallation is successful, the application is relaunched using the `coreAPI.relaunch` function.
   * @param name - The name of the plugin to uninstall.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const uninstall = async (name: string) => {
    // Send the filename of the to be uninstalled plugin
    // to the main process for removal
    const res = await pluginManager.uninstall([name])
    if (res) window.coreAPI?.relaunch()
  }

  /**
   * Downloads a remote plugin tarball and installs it using the `plugins.install` function.
   * If the installation is successful, the application is relaunched using the `coreAPI.relaunch` function.
   * @param pluginName - The name of the remote plugin to download and install.
   */
  const downloadTarball = async (pluginName: string) => {
    setIsLoading(true)
    const pluginPath = await window.coreAPI?.installRemotePlugin(pluginName)
    const installed = await pluginManager.install([pluginPath])
    setIsLoading(false)
    if (installed) window.coreAPI.relaunch()
  }

  /**
   * Handles the change event of the plugin file input element by setting the file name state.
   * Its to be used to display the plugin file name of the selected file.
   * @param event - The change event object.
   */
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      install(event)
    }
  }

  if (!isLoading) return <Loader description="Installing ..." />

  return (
    <div className="block w-full">
      {pluginCatalog
        .concat(
          activePlugins.filter(
            (e) => !(pluginCatalog ?? []).some((p) => p.name === e.name)
          ) ?? []
        )
        .map((item, i) => {
          const isActivePlugin = activePlugins.some((x) => x.name === item.name)
          const installedPlugin = activePlugins.filter(
            (p) => p.name === item.name
          )[0]
          const updateVersionPlugins = Number(
            installedPlugin?.version.replaceAll('.', '')
          )

          const hasUpdateVersionPlugins =
            item.version.replaceAll('.', '') > updateVersionPlugins

          return (
            <div
              key={i}
              className="flex w-full items-start justify-between border-b border-border py-4 first:pt-0 last:border-none"
            >
              <div className="w-4/5 flex-shrink-0 space-y-1.5">
                <div className="flex gap-x-2">
                  <h6 className="text-sm font-semibold capitalize">
                    {formatPluginsName(item.name)}
                  </h6>
                  <p className="whitespace-pre-wrap font-semibold leading-relaxed ">
                    v{item.version}
                  </p>
                </div>
                <p className="whitespace-pre-wrap leading-relaxed ">
                  {item.description}
                </p>
                {isActivePlugin && (
                  <div className="flex items-center gap-x-2">
                    <p className="whitespace-pre-wrap leading-relaxed ">
                      Installed{' '}
                      {hasUpdateVersionPlugins
                        ? `v${installedPlugin.version}`
                        : 'the latest version'}
                    </p>
                    {hasUpdateVersionPlugins && (
                      <Button
                        size="sm"
                        themes="secondary"
                        onClick={() => downloadTarball(item.name)}
                      >
                        Update
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {experimentalFeatureEnabed && (
                <Switch
                  checked={isActivePlugin}
                  onCheckedChange={(e) => {
                    if (e === true) {
                      downloadTarball(item.name)
                    } else {
                      uninstall(item.name)
                    }
                  }}
                />
              )}
            </div>
          )
        })}
      {/* Manual Installation */}
      <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-0 last:border-none">
        <div className="w-4/5 flex-shrink-0 space-y-1.5">
          <div className="flex gap-x-2">
            <h6 className="text-sm font-semibold capitalize">
              Manual Installation
            </h6>
          </div>
          <p className="whitespace-pre-wrap leading-relaxed ">
            Select a plugin file to install (.tgz)
          </p>
        </div>
        <div>
          <input
            type="file"
            style={{ display: 'none' }}
            ref={fileInputRef}
            onChange={handleFileChange}
          />
          <Button
            themes="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            Select
          </Button>
        </div>
      </div>
    </div>
  )
}

export default PluginCatalog
