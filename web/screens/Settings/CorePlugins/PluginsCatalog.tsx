'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Button, Switch } from '@uikit'
import Loader from '@containers/Loader'
import { formatPluginsName } from '@utils/converter'

import {
  plugins,
  extensionPoints,
} from '@/../../electron/core/plugin-manager/execution/index'

const PluginCatalog = () => {
  // const [search, setSearch] = useState<string>('')
  // const [fileName, setFileName] = useState('')
  const [activePlugins, setActivePlugins] = useState<any[]>([])
  const [pluginCatalog, setPluginCatalog] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const experimentRef = useRef(null)

  /**
   * Loads the plugin catalog module from a CDN and sets it as the plugin catalog state.
   * The `webpackIgnore` comment is used to prevent Webpack from bundling the module.
   */
  useEffect(() => {
    // @ts-ignore
    import(/* webpackIgnore: true */ PLUGIN_CATALOGS).then((module) => {
      setPluginCatalog(module.default)
    })
  }, [])

  /**
   * Fetches the active plugins and their preferences from the `plugins` and `preferences` modules.
   * If the `experimentComponent` extension point is available, it executes the extension point and
   * appends the returned components to the `experimentRef` element.
   * If the `PluginPreferences` extension point is available, it executes the extension point and
   * fetches the preferences for each plugin using the `preferences.get` function.
   */
  useEffect(() => {
    const getActivePlugins = async () => {
      const plgs = await plugins.getActive()
      setActivePlugins(plgs)

      if (extensionPoints.get('experimentComponent')) {
        const components = await Promise.all(
          extensionPoints.execute('experimentComponent')
        )
        components.forEach((e) => {
          if (experimentRef.current) {
            // @ts-ignore
            experimentRef.current.appendChild(e)
          }
        })
      }
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
    //@ts-ignore
    const pluginFile = new FormData(e.target).get('plugin-file').path

    // Send the filename of the to be installed plugin
    // to the main process for installation
    const installed = await plugins.install([pluginFile])
    if (installed) window.coreAPI?.relaunch()
  }

  /**
   * Uninstalls a plugin by calling the `plugins.uninstall` function with the plugin name.
   * If the uninstallation is successful, the application is relaunched using the `coreAPI.relaunch` function.
   * @param name - The name of the plugin to uninstall.
   */
  const uninstall = async (name: string) => {
    // Send the filename of the to be uninstalled plugin
    // to the main process for removal
    const res = await plugins.uninstall([name])
    if (res) window.coreAPI?.relaunch()
  }

  /**
   * Updates a plugin by calling the `window.pluggableElectronIpc.update` function with the plugin name.
   * If the update is successful, the application is relaunched using the `window.coreAPI.relaunch` function.
   * TODO: should update using window.coreAPI rather than pluggableElectronIpc (Plugin Manager Facades)
   * @param plugin - The name of the plugin to update.
   */
  const update = async (plugin: string) => {
    if (typeof window !== 'undefined') {
      // @ts-ignore
      await window.pluggableElectronIpc.update([plugin], true)
      window.coreAPI?.relaunch()
    }
  }

  /**
   * Downloads a remote plugin tarball and installs it using the `plugins.install` function.
   * If the installation is successful, the application is relaunched using the `coreAPI.relaunch` function.
   * @param pluginName - The name of the remote plugin to download and install.
   */
  const downloadTarball = async (pluginName: string) => {
    setIsLoading(true)
    const pluginPath = await window.coreAPI?.installRemotePlugin(pluginName)
    const installed = await plugins.install([pluginPath])
    setIsLoading(false)
    if (installed) window.coreAPI.relaunch()
  }

  /**
   * Handles the change event of the plugin file input element by setting the file name state.
   * Its to be used to display the plugin file name of the selected file.
   * @param event - The change event object.
   */
  // const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
  //   const file = event.target.files?.[0]
  //   if (file) {
  //     setFileName(file.name)
  //   } else {
  //     setFileName('')
  //   }
  // }

  return (
    <div className="block w-full">
      {pluginCatalog.map((item, i) => {
        const isActivePlugin = activePlugins.some((x) => x.name === item.name)
        const updateVersionPlugins = Number(
          activePlugins
            .filter((p) => p.name === item.name)[0]
            ?.version.replaceAll('.', '')
        )
        return (
          <div
            key={i}
            className="flex w-full items-start justify-between border-b border-gray-200 py-4 first:pt-0 last:border-none dark:border-gray-800"
          >
            <div className="w-4/5 flex-shrink-0 space-y-1.5">
              <div className="flex gap-x-2">
                <h6 className="text-sm font-semibold capitalize">
                  {formatPluginsName(item.name)}
                </h6>
                <p className="whitespace-pre-wrap font-semibold leading-relaxed text-gray-600 dark:text-gray-400">
                  v{item.version}
                </p>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed text-gray-600 dark:text-gray-400">
                {item.description}
              </p>
              {isActivePlugin &&
                item.version.replaceAll('.', '') < updateVersionPlugins && (
                  <Button
                    size="sm"
                    themes="outline"
                    onClick={() => downloadTarball(item.name)}
                  >
                    Update
                  </Button>
                )}
            </div>
            <Switch
              defaultChecked={isActivePlugin}
              onCheckedChange={(e) => {
                if (e === true) {
                  downloadTarball(item.name)
                } else {
                  uninstall(item.name)
                }
              }}
            />
          </div>
        )
      })}
      {isLoading && (
        <div className="fixed inset-0 z-50 flex h-full items-center justify-center gap-y-4 rounded-lg bg-gray-950/90 text-gray-400 dark:backdrop-blur-sm">
          <div className="space-y-16">
            <Loader />
            <p>Installing...</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default PluginCatalog
