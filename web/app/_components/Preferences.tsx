'use client'
import { useEffect, useRef, useState } from 'react'
import {
  plugins,
  extensionPoints,
} from '@/../../electron/core/plugin-manager/execution/index'
import {
  ChartPieIcon,
  CommandLineIcon,
  PlayIcon,
} from '@heroicons/react/24/outline'

import { MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import classNames from 'classnames'
import { PluginService, preferences } from '@janhq/core'
import { execute } from '../../../electron/core/plugin-manager/execution/extension-manager'
import LoadingIndicator from './LoadingIndicator'

export const Preferences = () => {
  const [search, setSearch] = useState<string>('')
  const [activePlugins, setActivePlugins] = useState<any[]>([])
  const [preferenceItems, setPreferenceItems] = useState<any[]>([])
  const [preferenceValues, setPreferenceValues] = useState<any[]>([])
  const [isTestAvailable, setIsTestAvailable] = useState(false)
  const [fileName, setFileName] = useState('')
  const [pluginCatalog, setPluginCatalog] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const experimentRef = useRef(null)
  const preferenceRef = useRef(null)

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
        if (components.length > 0) {
          setIsTestAvailable(true)
        }
        components.forEach((e) => {
          if (experimentRef.current) {
            // @ts-ignore
            experimentRef.current.appendChild(e)
          }
        })
      }

      if (extensionPoints.get('PluginPreferences')) {
        const data = await Promise.all(
          extensionPoints.execute('PluginPreferences')
        )
        setPreferenceItems(Array.isArray(data) ? data : [])
        Promise.all(
          (Array.isArray(data) ? data : []).map((e) =>
            preferences
              .get(e.pluginName, e.preferenceKey)
              .then((k) => ({ key: e.preferenceKey, value: k }))
          )
        ).then((data) => {
          setPreferenceValues(data)
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
   * Notifies plugins of a preference update by executing the `PluginService.OnPreferencesUpdate` event.
   * If a timeout is already set, it is cleared before setting a new timeout to execute the event.
   */
  let timeout: any | undefined = undefined
  function notifyPreferenceUpdate() {
    if (timeout) {
      clearTimeout(timeout)
    }
    if (extensionPoints.get(PluginService.OnPreferencesUpdate))
      timeout = setTimeout(
        () => execute(PluginService.OnPreferencesUpdate),
        100
      )
  }

  /**
   * Handles the change event of the plugin file input element by setting the file name state.
   * Its to be used to display the plugin file name of the selected file.
   * @param event - The change event object.
   */
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setFileName(file.name)
    } else {
      setFileName('')
    }
  }

  return (
    <div className="h-screen w-full overflow-scroll">
      <div className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-x-4 border-b border-gray-200 bg-white px-8 shadow-sm sm:gap-x-6 sm:px-6">
        {/* Separator */}
        <div className="hidden h-6 w-px bg-gray-900/10" aria-hidden="true" />

        <div className="flex flex-1 gap-x-6 self-stretch">
          <form className="relative flex flex-1" action="#" method="GET">
            <label htmlFor="search-field" className="sr-only">
              Search
            </label>
            <MagnifyingGlassIcon
              className="pointer-events-none absolute inset-y-0 left-0 h-full w-5 text-gray-400"
              aria-hidden="true"
            />
            <input
              defaultValue={search}
              onChange={(e) => setSearch(e.target.value)}
              id="search-field"
              className="block h-full w-full border-0 py-0 pl-8 pr-0 text-gray-900 placeholder:text-gray-400 focus:ring-0 sm:text-sm"
              placeholder="Search..."
              type="search"
              name="search"
            />
          </form>
        </div>
      </div>

      <main className="py-5">
        <div className="px-8 sm:px-6">
          {/* Content */}
          <div className="my-4 flex flex-row items-center">
            <ChartPieIcon width={30} />
            Install Plugin
          </div>
          <form id="plugin-file" onSubmit={install}>
            <div className="flex flex-row items-center space-x-10">
              <div className="flex w-[300px] items-center justify-center">
                <label className="dark:hover:bg-bray-800 flex h-[120px] w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:hover:border-gray-500 dark:hover:bg-gray-600">
                  {!fileName ? (
                    <div className="flex flex-col items-center justify-center pb-6 pt-5">
                      <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
                        <span className="font-semibold">Click to upload</span>{' '}
                        or drag and drop
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        TGZ (MAX 50MB)
                      </p>
                    </div>
                  ) : (
                    <>{fileName}</>
                  )}
                  <input
                    id="dropzone-file"
                    name="plugin-file"
                    type="file"
                    className="hidden"
                    onChange={handleFileChange}
                    required
                  />
                </label>
              </div>
              <div className="flex flex-col space-y-2">
                <button
                  type="submit"
                  className={classNames(
                    'rounded-md px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
                    fileName ? 'bg-blue-500 hover:bg-blue-300' : 'bg-gray-500'
                  )}
                >
                  Install Plugin
                </button>

                <button
                  className={classNames(
                    'rounded-md bg-blue-500 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600'
                  )}
                  onClick={() => {
                    window.coreAPI?.reloadPlugins()
                  }}
                >
                  Reload Plugins
                </button>
              </div>
            </div>
          </form>

          <div className="my-4 flex flex-row items-center">
            <CommandLineIcon width={30} />
            Installed Plugins
          </div>
          <div className="grid grid-cols-2 items-stretch gap-4">
            {activePlugins
              .filter(
                (e) =>
                  search.trim() === '' ||
                  e.name.toLowerCase().includes(search.toLowerCase())
              )
              .map((e) => (
                <div
                  key={e.name}
                  data-testid="plugin-item"
                  className="flex h-full flex-col rounded-sm border border-gray-200 bg-white p-6 dark:border-gray-300"
                >
                  <div className="flex flex-row items-center space-x-2">
                    <span className="relative mt-1 inline-block">
                      <img
                        className="h-14 w-14 rounded-md"
                        src={e.icon ?? 'icons/app_icon.svg'}
                        alt=""
                      />
                    </span>
                    <div className="flex flex-col">
                      <p className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
                        {e.name}
                      </p>
                      <p className="font-normal text-gray-700 dark:text-gray-400">
                        Version: {e.version}
                      </p>
                    </div>
                  </div>

                  <p className="mt-2 w-full flex-1 text-sm font-normal text-gray-500 dark:text-gray-400">
                    {e.description ?? "Jan's Plugin"}
                  </p>
                  <div className="flex flex-row space-x-5">
                    <button
                      type="submit"
                      onClick={() => {
                        uninstall(e.name)
                      }}
                      className="mt-5 rounded-md bg-red-500 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                    >
                      Uninstall
                    </button>
                    <button
                      type="submit"
                      onClick={() => {
                        update(e.name)
                      }}
                      className="mt-5 rounded-md bg-blue-500 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                    >
                      Update
                    </button>
                  </div>
                </div>
              ))}
          </div>

          <div className="my-4 flex flex-row items-center">
            <CommandLineIcon width={30} />
            Explore Plugins
          </div>
          <div className="grid grid-cols-2 items-stretch gap-4">
            {pluginCatalog
              .filter(
                (e: any) =>
                  search.trim() === '' ||
                  e.name.toLowerCase().includes(search.toLowerCase())
              )
              .map((e: any) => (
                <div
                  key={e.name}
                  data-testid="plugin-item"
                  className="flex h-full flex-col rounded-sm border border-gray-200 bg-white p-6 dark:border-gray-300"
                >
                  <div className="flex flex-row items-center space-x-2">
                    <span className="relative mt-1 inline-block">
                      <img
                        className="h-14 w-14 rounded-md"
                        src={e.icon ?? 'icons/app_icon.svg'}
                        alt=""
                      />
                    </span>
                    <div className="flex flex-col">
                      <p className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
                        {e.name}
                      </p>
                      <p className="font-normal text-gray-700 dark:text-gray-400">
                        Version: {e.version}
                      </p>
                    </div>
                  </div>

                  <p className="mt-2 w-full flex-1 text-sm font-normal text-gray-500 dark:text-gray-400">
                    {e.description ?? "Jan's Plugin"}
                  </p>

                  <div className="flex flex-row space-x-5">
                    {e.version !==
                      activePlugins.filter((p) => p.name === e.name)[0]
                        ?.version && (
                      <button
                        type="submit"
                        onClick={() => downloadTarball(e.name)}
                        className={classNames(
                          'mt-5 rounded-md px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600',
                          activePlugins.some((p) => p.name === e.name)
                            ? 'bg-blue-500 hover:bg-blue-600'
                            : 'bg-red-500 hover:bg-red-600'
                        )}
                      >
                        {activePlugins.some((p) => p.name === e.name)
                          ? 'Update'
                          : 'Install'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </div>
          {activePlugins.length > 0 && isTestAvailable && (
            <div className="my-4 flex flex-row items-center">
              <PlayIcon width={30} />
              Test Plugins
            </div>
          )}
          <div className="h-full w-full" ref={experimentRef}></div>

          <div className="my-4 flex flex-row items-center">
            <PlayIcon width={30} />
            Preferences
          </div>
          <div className="flex h-full w-full flex-col" ref={preferenceRef}>
            {preferenceItems?.map((e) => (
              <div key={e.preferenceKey} className="mb-4 flex flex-col">
                <div>
                  <span className="text-[16px] text-gray-600">Setting:</span>{' '}
                  <span className="text-[16px] text-gray-900">
                    {e.preferenceName}
                  </span>
                </div>
                <span className="text-[14px] text-gray-400">
                  {e.preferenceDescription}
                </span>
                <div className="mt-2 flex flex-row items-center space-x-4">
                  <input
                    className="h-8 w-1/3 rounded-sm border-[1px] border-gray-300 text-gray-500"
                    defaultValue={
                      preferenceValues.filter(
                        (v) => v.key === e.preferenceKey
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
        </div>
      </main>
      {isLoading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/90 text-white">
          <LoadingIndicator />
          Installing...
        </div>
      )}
    </div>
  )
}
