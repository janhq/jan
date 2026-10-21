/**
 * Banner for the local CPU engines (LiteRT-LM, OpenVINO).
 *
 * These engines run through a python runtime that has to be present. The
 * banner says whether it is, and offers to install it, so the whole setup
 * can be done from the app.
 */

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { IconAlertTriangle, IconCheck, IconDownload, IconLoader2 } from '@tabler/icons-react'
import { getJanDataFolderPath } from '@janhq/core'
import {
  checkLocalEngine,
  installLocalEngineRuntime,
} from '@janhq/tauri-plugin-local-engine-api'

type LocalEngineRuntimeBannerProps = {
  /** The provider id of the engine, e.g. `litert-lm`. */
  engine: string
  /** Human readable name of the engine. */
  name: string
  /** The runtime package the interpreter has to provide. */
  packageName?: string
}

/**
 * The engines whose runtime Jan can install on the user's behalf.
 *
 * A provider that is not listed here is left alone: the user manages it.
 */
const MANAGED_RUNTIMES: Record<string, { package: string }> = {
  'litert-lm': { package: 'litert-lm' },
  openvino: { package: 'openvino + openvino-genai' },
}

export const LocalEngineRuntimeBanner = ({
  engine,
  name,
  packageName,
}: LocalEngineRuntimeBannerProps) => {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [installing, setInstalling] = useState(false)

  const check = useCallback(async () => {
    try {
      const result = await checkLocalEngine(engine, await getJanDataFolderPath())
      setAvailable(result.available)
      setError(result.error)
    } catch (err) {
      setAvailable(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [engine])

  useEffect(() => {
    void check()
  }, [check])

  const install = async () => {
    setInstalling(true)
    try {
      await installLocalEngineRuntime(engine, await getJanDataFolderPath())
      await check()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setInstalling(false)
    }
  }

  // Still checking: render nothing rather than a flash of the warning.
  if (available === null) return null

  if (available) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3">
        <IconCheck size={18} className="mt-0.5 shrink-0 text-green-600" />
        <div className="text-sm">
          <p className="font-medium">{name} runtime is ready</p>
          <p className="text-muted-foreground">
            Models for this engine run on the machine, on the CPU.
          </p>
        </div>
      </div>
    )
  }

  const managed = MANAGED_RUNTIMES[engine]

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <IconAlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
      <div className="flex-1 text-sm">
        <p className="font-medium">The {name} runtime is not installed</p>
        <p className="text-muted-foreground">
          {error ?? `The '${packageName}' package is missing.`}
        </p>
        {managed && (
          <Button
            className="mt-2"
            size="sm"
            variant="secondary"
            onClick={install}
            disabled={installing}
          >
            {installing ? (
              <IconLoader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <IconDownload className="mr-2 size-4" />
            )}
            {installing ? 'Installing...' : `Install ${managed.package}`}
          </Button>
        )}
      </div>
    </div>
  )
}
