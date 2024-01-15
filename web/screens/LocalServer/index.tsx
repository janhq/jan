import { Button } from '@janhq/uikit'
import { useAtom, useAtomValue } from 'jotai'

import { ExternalLinkIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import DropdownListSidebar from '@/containers/DropdownListSidebar'

import { showRightSideBarAtom } from '../Chat/Sidebar'

import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'

const LocalServerScreen = () => {
  const [serverEnabled, setServerEnabled] = useAtom(serverEnabledAtom)
  const showing = useAtomValue(showRightSideBarAtom)

  return (
    <div className="flex h-full w-full">
      {/* Left SideBar */}
      <div className="flex h-full w-60 flex-shrink-0 flex-col overflow-y-auto border-r border-border">
        <div className="p-4">
          <h2 className="font-bold">Server Options</h2>
          <p className="mt-2 leading-relaxed">
            Start an OpenAI-compatible local HTTP server.
          </p>
        </div>
        <div className="border-b border-border pb-8">
          <div className="space-y-3 px-4">
            <Button
              block
              themes={serverEnabled ? 'danger' : 'success'}
              onClick={() => {
                if (serverEnabled) {
                  window.core?.api?.stopServer()
                  setServerEnabled(false)
                } else {
                  window.core?.api?.startServer()
                  setServerEnabled(true)
                }
              }}
            >
              {serverEnabled ? 'Stop' : 'Start'} Server
            </Button>
            <Button block themes="secondaryBlue" asChild>
              <a href="https://jan.ai/api-reference/" target="_blank">
                API Reference <ExternalLinkIcon size={20} className="ml-2" />
              </a>
            </Button>
          </div>
        </div>
      </div>

      {/* Middle Bar */}
      <div className="relative flex h-full w-full flex-col overflow-auto bg-background p-4">
        <div className="flex h-full w-full flex-col justify-between">
          <p>
            Lorem ipsum dolor sit amet, consectetur adipisicing elit. Eius iusto
            aspernatur blanditiis, culpa harum ex hic atque quae tempora eaque
            obcaecati voluptas nulla error repellat aliquam minima laborum
            corporis fuga.
          </p>
        </div>
      </div>

      {/* Right bar */}
      <div
        className={twMerge(
          'h-full flex-shrink-0 overflow-x-hidden border-l border-border bg-background transition-all duration-100 dark:bg-background/20',
          showing
            ? 'w-80 translate-x-0 opacity-100'
            : 'w-0 translate-x-full opacity-0'
        )}
      >
        <p>
          Lorem, ipsum dolor sit amet consectetur adipisicing elit. Cumque earum
          numquam fugit quia quisquam id quos aspernatur unde voluptatem neque,
          officiis doloribus, laborum totam ad deserunt corporis impedit beatae
          vitae?
        </p>
      </div>
    </div>
  )
}

export default LocalServerScreen
