import type {
  CommandHandler,
  Contributions,
  ExtensionModule,
} from '@janhq/extension-api'
import {
  ContributionStore,
  useContributions,
} from '@/lib/extensions/contributions'
import { ExtensionHost } from '@/lib/extensions/host'
import { builtin, manifest } from '@/lib/extensions/__tests__/fixtures'
import {
  memoryAppSettings,
  memorySecrets,
} from '@/lib/extensions/__tests__/memory'

/**
 * A real host writing into the app-wide `useContributions` store, as
 * `getExtensionHost()` does, but on in-memory backends.
 */
export function createTestHost() {
  const appSettings = memoryAppSettings()
  const secrets = memorySecrets()
  const host = new ExtensionHost({
    appSettings,
    secrets,
    notify: () => undefined,
    contributions: new ContributionStore(useContributions),
  })

  /** Activates a fixture extension binding `handlers` to its commands. */
  const activate = async (
    id: string,
    displayName: string,
    contributes: Contributions,
    handlers: Record<string, CommandHandler> = {}
  ) => {
    const mod: ExtensionModule = {
      activate: (ctx) => {
        for (const [command, handler] of Object.entries(handlers))
          ctx.subscriptions.add(ctx.commands.registerCommand(command, handler))
      },
    }
    await host.activateBuiltin(
      builtin(manifest(id, { displayName, contributes }), mod)
    )
  }

  return { host, appSettings, secrets, activate }
}
