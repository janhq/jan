import React, { useEffect, useState } from 'react'
import { preferences } from "@janhq/core"
import { Button } from '@uikit'
const RemoteServer = () => {
  const [apiKey, setApiKey] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  useEffect(() => {
    preferences.get("JanServer", "apiKey").then((result => setApiKey(result)));
    preferences.get("JanServer", "serverUrl").then((result => setServerUrl(result)));
  }, [])

  const openRemoteServer = async () => {
    window.coreAPI?.openWindow(`${serverUrl}/login?apiKey=${apiKey}`);
  }

  const onChangeApiKey = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKey(e.target.value);
    preferences.set("JanServer", "apiKey", e.target.value)
  }

  const onChangeServerUrl = (e: React.ChangeEvent<HTMLInputElement>) => {
    setServerUrl(e.target.value);
    preferences.set("JanServer", "serverUrl", e.target.value)
  }

  return (
    <div className="flex h-full">
      <div className="flex h-full w-80 flex-shrink-0 flex-col overflow-y-auto border-r border-border">
        <div className="p-5">
          <h1 className="text-lg font-bold">Remote Server</h1>
          <p
            data-testid="testid-setting-description"
            className="mt-2 text-gray-600 text-muted-foreground"
          >
            <div className="border-border flex w-full items-center justify-between border-b py-3 first:pt-0 last:border-none">
              <div className="flex-shrink-0 space-y-1">
                <h6 className="text-sm font-semibold capitalize">API Key</h6>
                <p className="leading-relaxed text-gray-600 dark:text-gray-400">
                  <input
                    type='password'
                    name="apiKey"
                    id="apiKey"
                    className="block w-full resize-none border-0 py-1.5 placeholder:text-gray-400 focus:ring-0 sm:text-sm sm:leading-6"
                    placeholder="API Key"
                    value={apiKey}
                    onChange={onChangeApiKey}
                  />
                </p>
              </div>
            </div>
            <div className="border-border flex w-full items-center justify-between border-b py-3 first:pt-0 last:border-none">
              <div className="flex-shrink-0 space-y-1">
                <h6 className="text-sm font-semibold capitalize">Server URL</h6>
                <p className="leading-relaxed text-gray-600 dark:text-gray-400">
                  <input
                    name="serverUrl"
                    id="serverUrl"
                    className="block w-full resize-none border-0 py-1.5 placeholder:text-gray-400 focus:ring-0 sm:text-sm sm:leading-6"
                    placeholder="https://jan.ai"
                    value={serverUrl}
                    onChange={onChangeServerUrl}
                  />
                </p>
              </div>
            </div>
            <Button
              themes="accent"
              onClick={openRemoteServer}
            >
              Open
            </Button>
          </p>
        </div>
      </div>
    </div>


  )
}

export default RemoteServer
