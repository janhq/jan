/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useRef } from 'react'

import { Button, ScrollArea, Badge } from '@janhq/joi'
import { Marked, Renderer } from 'marked'

import Loader from '@/containers/Loader'

import { formatExtensionsName } from '@/utils/converter'

import { extensionManager } from '@/extension'
import Extension from '@/extension/Extension'

const ExtensionCatalog = () => {
  const [activeExtensions, setActiveExtensions] = useState<Extension[]>([])
  const [showLoading, setShowLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  /**
   * Fetches the active extensions and their preferences from the `extensions` and `preferences` modules.
   * If the `experimentComponent` extension point is available, it executes the extension point and
   * appends the returned components to the `experimentRef` element.
   * If the `ExtensionPreferences` extension point is available, it executes the extension point and
   * fetches the preferences for each extension using the `preferences.get` function.
   */
  useEffect(() => {
    const getActiveExtensions = async () => {
      const exts = await extensionManager.getActive()
      if (Array.isArray(exts)) setActiveExtensions(exts)
    }
    getActiveExtensions()
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

  return (
    <>
      <ScrollArea className="h-full w-full px-4">
        <div className="block w-full">
          {activeExtensions.map((item, i) => {
            return (
              <div
                key={i}
                className="flex w-full flex-col items-start justify-between border-b border-[hsla(var(--app-border))] py-4 first:pt-4 last:border-none sm:flex-row"
              >
                <div className="w-full flex-shrink-0 space-y-1.5 sm:w-4/5">
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
                      className="font-medium leading-relaxed text-[hsla(var(--app-text-secondary))]"
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
          {/* Manual Installation */}
          <div className="flex w-full flex-col items-start justify-between gap-y-2 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
            <div className="w-4/5 flex-shrink-0 space-y-1.5">
              <div className="flex gap-x-2">
                <h6 className="text-sm font-semibold capitalize">
                  Manual Installation
                </h6>
              </div>
              <p className="font-medium leading-relaxed text-[hsla(var(--app-text-secondary))]">
                Select an extension file to install (.tgz)
              </p>
            </div>
            <div>
              <input
                type="file"
                hidden
                ref={fileInputRef}
                onChange={handleFileChange}
              />
              <Button
                variant="soft"
                size="small"
                onClick={() => fileInputRef.current?.click()}
              >
                Select
              </Button>
            </div>
          </div>
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
          "<a class='text-[hsla(var(--app-link))]' target='_blank'"
        )
    },
  },
})

export default ExtensionCatalog
