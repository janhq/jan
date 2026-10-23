import { create, type StoreApi } from 'zustand'
import {
  ExtensionError,
  toDisposable,
  type CommandContext,
  type CommandContribution,
  type CommandHandler,
  type Disposable,
  type JsonValue,
  type MenuItemContribution,
  type MenuLocation,
  type ProviderContribution,
  type ProviderHandlers,
  type SettingContribution,
  type StatusItemContribution,
  type ToolContribution,
  type ToolHandler,
  type ValidatedManifest,
} from '@janhq/extension-api'

export type RegisteredCommand = CommandContribution & {
  handler?: CommandHandler
}
export type RegisteredTool = ToolContribution & { handler?: ToolHandler }
export type RegisteredProvider = ProviderContribution & {
  handler?: ProviderHandlers
}

/**
 * Everything extensions contribute to the host UI, keyed by extension id and
 * then by the id the manifest declared. Keying by extension first is what
 * lets two extensions both declare a command `hello`.
 */
export interface ContributionState {
  extensions: Record<string, { displayName: string }>
  commands: Record<string, Record<string, RegisteredCommand>>
  menus: Record<string, Partial<Record<MenuLocation, MenuItemContribution[]>>>
  statusItems: Record<string, Record<string, StatusItemContribution>>
  settings: Record<string, SettingContribution[]>
  tools: Record<string, Record<string, RegisteredTool>>
  providers: Record<string, Record<string, RegisteredProvider>>
}

const emptyState = (): ContributionState => ({
  extensions: {},
  commands: {},
  menus: {},
  statusItems: {},
  settings: {},
  tools: {},
  providers: {},
})

const byId = <T, K extends keyof T>(
  items: T[] | undefined,
  field: K
): Record<string, T> =>
  Object.fromEntries((items ?? []).map((item) => [String(item[field]), item]))

const without = <T>(
  record: Record<string, T>,
  id: string
): Record<string, T> => {
  const next = { ...record }
  delete next[id]
  return next
}

/** The app-wide contributions, read by the host renderers. */
export const useContributions = create<ContributionState>()(emptyState)

interface HandlerEntries {
  commands: RegisteredCommand
  tools: RegisteredTool
  providers: RegisteredProvider
}
type HandlerSlice = keyof HandlerEntries

/** The slices that carry runtime bindings, typed per slice. */
const handlerSlices = (
  s: ContributionState
): { [K in HandlerSlice]: Record<string, Record<string, HandlerEntries[K]>> } =>
  s

/**
 * Writes to a contributions store. Declarations come only from manifests;
 * extensions can bind handlers to what they declared but never add entries
 * at runtime, so the UI and the consent screen show the same set.
 */
export class ContributionStore {
  constructor(
    private readonly store: StoreApi<ContributionState> = create<ContributionState>()(
      emptyState
    )
  ) {}

  getState(): ContributionState {
    return this.store.getState()
  }

  /** Adds every declared contribution of `manifest`; dispose removes them all. */
  registerExtension(manifest: ValidatedManifest): Disposable {
    const { id, contributes = {} } = manifest
    if (id in this.getState().extensions) {
      throw new ExtensionError(
        'E_INVALID_ARGS',
        `Extension '${id}' is already registered`
      )
    }
    this.store.setState((s) => ({
      extensions: {
        ...s.extensions,
        [id]: { displayName: manifest.displayName },
      },
      commands: { ...s.commands, [id]: byId(contributes.commands, 'id') },
      menus: { ...s.menus, [id]: contributes.menus ?? {} },
      statusItems: {
        ...s.statusItems,
        [id]: byId(contributes.statusItems, 'id'),
      },
      settings: { ...s.settings, [id]: contributes.settings ?? [] },
      tools: { ...s.tools, [id]: byId(contributes.tools, 'name') },
      providers: { ...s.providers, [id]: byId(contributes.providers, 'id') },
    }))
    return toDisposable(() =>
      this.store.setState((s) => ({
        extensions: without(s.extensions, id),
        commands: without(s.commands, id),
        menus: without(s.menus, id),
        statusItems: without(s.statusItems, id),
        settings: without(s.settings, id),
        tools: without(s.tools, id),
        providers: without(s.providers, id),
      }))
    )
  }

  registerCommand(
    extensionId: string,
    commandId: string,
    handler: CommandHandler
  ): Disposable {
    return this.bind('commands', extensionId, commandId, handler)
  }

  registerTool(
    extensionId: string,
    name: string,
    handler: ToolHandler
  ): Disposable {
    return this.bind('tools', extensionId, name, handler)
  }

  registerProvider(
    extensionId: string,
    providerId: string,
    handlers: ProviderHandlers
  ): Disposable {
    return this.bind('providers', extensionId, providerId, handlers)
  }

  setStatusItem(
    extensionId: string,
    itemId: string,
    update: { text?: string; tooltip?: string }
  ): void {
    const item = this.getState().statusItems[extensionId]?.[itemId]
    if (!item)
      throw new ExtensionError(
        'E_NOT_FOUND',
        `Status item '${itemId}' is not declared`
      )
    this.store.setState((s) => ({
      statusItems: {
        ...s.statusItems,
        [extensionId]: {
          ...s.statusItems[extensionId],
          [itemId]: { ...item, ...update },
        },
      },
    }))
  }

  /** Runs a bound command of one extension. */
  async executeCommand(
    extensionId: string,
    commandId: string,
    context: CommandContext,
    ...args: JsonValue[]
  ): Promise<unknown> {
    const handler = this.getState().commands[extensionId]?.[commandId]?.handler
    if (!handler)
      throw new ExtensionError(
        'E_NOT_FOUND',
        `Command '${commandId}' has no handler`
      )
    return handler(context, ...args)
  }

  private bind<S extends HandlerSlice>(
    slice: S,
    extensionId: string,
    entryId: string,
    value: NonNullable<HandlerEntries[S]['handler']>
  ): Disposable {
    const read = () =>
      handlerSlices(this.getState())[slice][extensionId]?.[entryId]
    const entry = read()
    if (!entry)
      throw new ExtensionError(
        'E_NOT_FOUND',
        `'${entryId}' is not declared in contributes.${slice}`
      )
    if (entry.handler !== undefined)
      throw new ExtensionError(
        'E_INVALID_ARGS',
        `'${entryId}' is already registered`
      )
    const set = (next: typeof value | undefined) =>
      this.store.setState((s) => {
        const entries = handlerSlices(s)[slice]
        return {
          [slice]: {
            ...entries,
            [extensionId]: {
              ...entries[extensionId],
              [entryId]: { ...entries[extensionId][entryId], handler: next },
            },
          },
        }
      })
    set(value)
    return toDisposable(() => {
      // The extension may have been unregistered and registered again since;
      // only clear the binding if it is still this one.
      if (read()?.handler === value) set(undefined)
    })
  }
}
