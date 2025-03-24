/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useRef } from 'react'

import { Button, ScrollArea, Badge, Input } from '@janhq/joi'

import { useAtomValue } from 'jotai'
import { SearchIcon } from 'lucide-react'
import { Marked, Renderer } from 'marked'

import Loader from '@/containers/Loader'

import { useApp } from '@/hooks/useApp'

import { formatExtensionsName } from '@/utils/converter'

import { extensionManager } from '@/extension'
import Extension from '@/extension/Extension'
import { showScrollBarAtom } from '@/helpers/atoms/Setting.atom'

const ExtensionCatalog = () => {
  const [coreActiveExtensions, setCoreActiveExtensions] = useState<Extension[]>(
    []
  )
  const showScrollBar = useAtomValue(showScrollBarAtom)
  const [searchText, setSearchText] = useState('')
  const [showLoading, setShowLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { relaunch } = useApp()

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
          if (settings && settings.length > 0) {
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
    if (installed) relaunch()
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
    if (res) relaunch()
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
      <ScrollArea
        type={showScrollBar ? 'always' : 'scroll'}
        className="h-full w-full"
      >
        <div className="flex w-full flex-col items-start justify-between gap-y-2 p-4 sm:flex-row">
          <div className="w-full sm:w-[300px]">
            <Input
              prefixIcon={<SearchIcon size={16} />}
              placeholder="Search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              clearable={searchText.length > 0}
              onClear={() => setSearchText('')}
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
          "<a class='text-[hsla(var(--app-link))]' target='_blank'"
        )
    },
  },
})

export default ExtensionCatalog
