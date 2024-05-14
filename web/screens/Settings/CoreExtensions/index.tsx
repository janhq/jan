/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useRef, useCallback } from 'react'

import { InferenceEngine } from '@janhq/core'

import { Button, ScrollArea, Badge, Switch, Input } from '@janhq/joi'
import { useAtom } from 'jotai'
import { SearchIcon } from 'lucide-react'
import { Marked, Renderer } from 'marked'

import Loader from '@/containers/Loader'

import SetupRemoteModel from '@/containers/SetupRemoteModel'

import { formatExtensionsName } from '@/utils/converter'

import { extensionManager } from '@/extension'
import Extension from '@/extension/Extension'
import { inActiveEngineProviderAtom } from '@/helpers/atoms/Extension.atom'

type EngineExtension = {
  provider: InferenceEngine
} & Extension

const ExtensionCatalog = () => {
  const [coreActiveExtensions, setCoreActiveExtensions] = useState<Extension[]>(
    []
  )
  const [engineActiveExtensions, setEngineActiveExtensions] = useState<
    EngineExtension[]
  >([])
  const [searchText, setSearchText] = useState('')
  const [showLoading, setShowLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const getAllSettings = async () => {
      const extensionsMenu = []
      const engineMenu = []
      const extensions = extensionManager.getAll()

      for (const extension of extensions) {
        const settings = await extension.getSettings()
        if (
          typeof extension.getSettings === 'function' &&
          'provider' in extension &&
          typeof extension.provider === 'string'
        ) {
          if (
            (settings && settings.length > 0) ||
            (await extension.installationState()) !== 'NotRequired'
          ) {
            engineMenu.push({
              ...extension,
              provider:
                'provider' in extension &&
                typeof extension.provider === 'string'
                  ? extension.provider
                  : '',
            })
          }
        } else {
          extensionsMenu.push({
            ...extension,
          })
        }
      }

      setCoreActiveExtensions(extensionsMenu)
      setEngineActiveExtensions(engineMenu as any)
    }
    getAllSettings()
  }, [])

  /**
   * Installs a extension by calling the `extensions.install` function with the extension file path.
   * If the installation is successful, the application is relaunched using the `coreAPI.relaunch` function.
   * @param e - The event object.
   */
  const install = async (e: any) => {
    e.preventDefault()
    const extensionFile = e.target.files?.[0].path

    // Send the filename of the to be installed extension
    // to the main process for installation
    const installed = await extensionManager.install([extensionFile])
    if (installed) window.core?.api?.relaunch()
  }

  /**
   * Uninstalls a extension by calling the `extensions.uninstall` function with the extension name.
   * If the uninstallation is successful, the application is relaunched using the `coreAPI.relaunch` function.
   * @param name - The name of the extension to uninstall.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const uninstall = async (name: string) => {
    // Send the filename of the to be uninstalled extension
    // to the main process for removal
    const res = await extensionManager.uninstall([name])
    if (res) window.core?.api?.relaunch()
  }

  /**
   * Handles the change event of the extension file input element by setting the file name state.
   * Its to be used to display the extension file name of the selected file.
   * @param event - The change event object.
   */
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setShowLoading(true)
      install(event)
    }
  }

  const INACTIVE_ENGINE_PROVIDER = 'inActiveEngineProvider'

  const [inActiveEngineProvider, setInActiveEngineProvider] = useAtom(
    inActiveEngineProviderAtom
  )

  useEffect(() => {
    if (localStorage.getItem(INACTIVE_ENGINE_PROVIDER) === null) {
      localStorage.setItem(INACTIVE_ENGINE_PROVIDER, '[]')
      setInActiveEngineProvider([])
    } else {
      setInActiveEngineProvider(
        JSON.parse(String(localStorage.getItem(INACTIVE_ENGINE_PROVIDER)))
      )
    }
  }, [])

  const onSwitchChange = useCallback(
    (name: string) => {
      if (inActiveEngineProvider.includes(name)) {
        setInActiveEngineProvider(
          [...inActiveEngineProvider].filter((x) => x !== name)
        )
        localStorage.setItem(
          INACTIVE_ENGINE_PROVIDER,
          JSON.stringify([...inActiveEngineProvider].filter((x) => x !== name))
        )
      } else {
        setInActiveEngineProvider([...inActiveEngineProvider, name])
        localStorage.setItem(
          INACTIVE_ENGINE_PROVIDER,
          JSON.stringify([...inActiveEngineProvider, name])
        )
      }
    },
    [inActiveEngineProvider, setInActiveEngineProvider]
  )

  return (
    <>
      <ScrollArea className="h-full w-full">
        <div className="flex w-full flex-col items-start justify-between gap-y-2 p-4 sm:flex-row">
          <div className="w-full sm:w-[300px]">
            <Input
              prefixIcon={<SearchIcon size={16} />}
              placeholder="Search"
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
          <div>
            <input
              type="file"
              hidden
              ref={fileInputRef}
              onChange={handleFileChange}
            />
            <Button onClick={() => fileInputRef.current?.click()}>
              Install Extension
            </Button>
          </div>
        </div>

        <div className="block w-full px-4">
          {engineActiveExtensions.length !== 0 && (
            <div className="mb-3 mt-4 border-b border-[hsla(var(--app-border))] pb-4">
              <h6 className="text-base font-semibold text-[hsla(var(--text-primary))]">
                Inference Engines
              </h6>
            </div>
          )}
          {engineActiveExtensions
            .filter((x) => x.name.includes(searchText.toLowerCase().trim()))
            .sort((a, b) => a.provider.localeCompare(b.provider))
            .map((item, i) => {
              return (
                <div
                  key={i}
                  className="flex w-full flex-col items-start justify-between py-3 sm:flex-row"
                >
                  <div className="w-full flex-shrink-0 space-y-1.5">
                    <div className="flex items-center justify-between gap-x-2">
                      <div className="flex items-center gap-x-2">
                        <h6 className="line-clamp-1 font-semibold">
                          {item.productName?.replace('Inference Engine', '') ??
                            formatExtensionsName(item.name)}
                        </h6>
                        <Badge variant="outline" theme="secondary">
                          v{item.version}
                        </Badge>
                        <p>{item.provider}</p>
                      </div>
                      <div className="flex items-center gap-x-2">
                        {!inActiveEngineProvider.includes(item.provider) && (
                          <SetupRemoteModel engine={item.provider} />
                        )}
                        <Switch
                          checked={
                            !inActiveEngineProvider.includes(item.provider)
                          }
                          onChange={() => onSwitchChange(item.provider)}
                        />
                      </div>
                    </div>
                    {
                      <div
                        className="w-full font-medium leading-relaxed text-[hsla(var(--text-secondary))] sm:w-4/5"
                        dangerouslySetInnerHTML={{
                          // eslint-disable-next-line @typescript-eslint/naming-convention
                          __html: marked.parse(item.description ?? '', {
                            async: false,
                          }),
                        }}
                      />
                    }
                  </div>
                </div>
              )
            })}

          {coreActiveExtensions.length > 0 && (
            <div className="mb-3 mt-8 border-b border-[hsla(var(--app-border))] pb-4">
              <h6 className="text-base font-semibold text-[hsla(var(--text-primary))]">
                Core Extention
              </h6>
            </div>
          )}
          {coreActiveExtensions
            .filter((x) => x.name.includes(searchText.toLowerCase().trim()))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((item, i) => {
              return (
                <div
                  key={i}
                  className="flex w-full flex-col items-start justify-between py-3 sm:flex-row"
                >
                  <div className="w-full flex-shrink-0 space-y-1.5">
                    <div className="flex items-center gap-x-2">
                      <h6 className="line-clamp-1 font-semibold">
                        {item.productName ?? formatExtensionsName(item.name)}
                      </h6>
                      <Badge variant="outline" theme="secondary">
                        v{item.version}
                      </Badge>
                    </div>
                    {
                      <div
                        className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]"
                        dangerouslySetInnerHTML={{
                          // eslint-disable-next-line @typescript-eslint/naming-convention
                          __html: marked.parse(item.description ?? '', {
                            async: false,
                          }),
                        }}
                      />
                    }
                  </div>
                </div>
              )
            })}
        </div>
      </ScrollArea>
      {showLoading && <Loader description="Installing..." />}
    </>
  )
}

const marked: Marked = new Marked({
  renderer: {
    link: (href, title, text) => {
      return Renderer.prototype.link
        ?.apply(this, [href, title, text])
        .replace(
          '<a',
          "<a class='text-[hsla(var(--text-link))]' target='_blank'"
        )
    },
  },
})

export default ExtensionCatalog
