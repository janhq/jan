import { Button } from '@janhq/uikit'
import { useAtom } from 'jotai'

import { ExternalLinkIcon } from 'lucide-react'

import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'

const LocalServerScreen = () => {
  const [serverEnabled, setServerEnabled] = useAtom(serverEnabledAtom)

  return (
    <div className="flex h-full w-full">
      {/* Left SideBar */}
      <div className="flex h-full w-60 flex-shrink-0 flex-col overflow-y-auto border-r border-border p-4">
        <h2 className="font-bold">Server Options</h2>
        <p className="mt-2 leading-relaxed">
          Start an OpenAI-compatible local HTTP server.
        </p>

        <div className="mt-4 space-y-3">
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
    </div>
  )
}

export default LocalServerScreen
