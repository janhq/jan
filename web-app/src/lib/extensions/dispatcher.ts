import { z, type ZodType } from 'zod'
import {
  ExtensionError,
  isContributionId,
  networkHostMatches,
  networkHostOf,
  type JsonValue,
  type PermissionString,
  type ValidatedManifest,
} from '@janhq/extension-api'
import type {
  HostArgs,
  HostEvents,
  HostMethod,
  HostResult,
} from '@janhq/extension-runtime'
import type { CallOptions, HostApi } from './host-api'
import { matchesNetwork } from './permissions'

/**
 * Which grant a call needs. A function decides from the validated arguments,
 * for the methods whose permission depends on what they touch.
 */
export type PermissionCheck =
  | PermissionString
  | ((
      args: unknown[],
      manifest: ValidatedManifest,
      dispatcher: PermissionDispatcher
    ) => void)

export interface MethodPolicy<M extends HostMethod> {
  permission: PermissionCheck | 'implicit'
  args: ZodType<HostArgs<M>>
}

const fn = <F>() =>
  z.custom<F>((v) => typeof v === 'function', 'Expected a function')

const json: ZodType<JsonValue> = z.json()
const id = z.string().min(1).max(256)
// Command, status item, tool and provider ids, in the manifest's grammar.
const contributionId = z
  .string()
  .refine(isContributionId, 'Expected a contribution id as in the manifest')
const settingValue = z.union([z.string(), z.number(), z.boolean()])
const statusUpdate = z.strictObject({
  text: z.string().max(256).optional(),
  tooltip: z.string().max(1024).optional(),
})
const httpInit = z.strictObject({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
})
const absoluteUrl = z.string().refine((u) => URL.canParse(u), 'Expected an absolute URL')

const subscription = <E extends keyof HostEvents>(name: E) =>
  z.tuple([z.literal(name), fn<(event: HostEvents[E]) => void>()])

const eventPermission: Record<keyof HostEvents, PermissionString | 'implicit'> = {
  'settings.didChange': 'implicit',
  'conversations.didCreateMessage': 'conversations:read',
  'conversations.didDeleteThread': 'conversations:read',
}

/**
 * Every host method with the grant it needs and the shape of its arguments.
 * The mapped type makes the table exhaustive: a method added to
 * `HostMethod` does not compile until it has a policy here.
 */
export const METHOD_POLICY: { [M in HostMethod]: MethodPolicy<M> } = {
  'log': {
    permission: 'implicit',
    args: z.tuple([z.enum(['debug', 'info', 'warn', 'error'])], z.unknown()),
  },
  'settings.get': { permission: 'implicit', args: z.tuple([id]) },
  'settings.set': {
    permission: 'implicit',
    args: z.tuple([id, settingValue]),
  },
  'storage.get': { permission: 'implicit', args: z.tuple([id]) },
  'storage.set': { permission: 'implicit', args: z.tuple([id, json]) },
  'storage.delete': { permission: 'implicit', args: z.tuple([id]) },
  'storage.keys': { permission: 'implicit', args: z.tuple([]) },
  'commands.register': {
    permission: 'implicit',
    args: z.tuple([contributionId, fn<HostArgs<'commands.register'>[1]>()]),
  },
  'commands.execute': {
    // Only the extension's own commands are reachable (see createHostApi's
    // 'commands.execute' handler).
    permission: 'implicit',
    args: z.tuple([contributionId], json),
  },
  'ui.notify': {
    permission: 'ui:notify',
    args: z.tuple([
      z.strictObject({
        level: z.enum(['info', 'success', 'warning', 'error']),
        message: z.string().max(2000),
      }),
    ]),
  },
  'ui.setStatusItem': {
    permission: 'implicit',
    args: z.tuple([contributionId, statusUpdate]),
  },
  'conversations.listThreads': {
    permission: 'conversations:read',
    args: z.tuple([]),
  },
  'conversations.getThread': {
    permission: 'conversations:read',
    args: z.tuple([id]),
  },
  'conversations.listMessages': {
    permission: 'conversations:read',
    args: z.tuple([
      id,
      z
        .strictObject({
          limit: z.int().positive().max(1000).optional(),
          before: id.optional(),
        })
        .optional(),
    ]),
  },
  'conversations.createThread': {
    permission: 'conversations:write',
    args: z.tuple([z.strictObject({ title: z.string().max(256) })]),
  },
  'conversations.appendMessage': {
    permission: 'conversations:write',
    args: z.tuple([
      id,
      z.strictObject({
        role: z.enum(['user', 'assistant']),
        text: z.string(),
      }),
    ]),
  },
  'tools.register': {
    permission: 'tools',
    args: z.tuple([contributionId, fn<HostArgs<'tools.register'>[1]>()]),
  },
  'providers.register': {
    permission: 'providers',
    args: z.tuple([
      contributionId,
      z.strictObject({
        listModels: fn<NonNullable<HostArgs<'providers.register'>[1]['listModels']>>().optional(),
      }),
    ]),
  },
  'http.fetch': {
    permission: (args, manifest, dispatcher) =>
      dispatcher.checkUrl(manifest.id, args[0] as string),
    args: z.tuple([absoluteUrl, httpInit.optional()]),
  },
  'events.subscribe': {
    permission: (args, manifest, dispatcher) => {
      const needed = eventPermission[args[0] as keyof HostEvents]
      if (needed !== 'implicit') dispatcher.check(manifest.id, needed)
    },
    args: z.union([
      subscription('settings.didChange'),
      subscription('conversations.didCreateMessage'),
      subscription('conversations.didDeleteThread'),
    ]),
  },
}

/**
 * The single place that decides whether an extension may make a host call.
 * Built-ins are granted what their manifest requests; workers what the
 * user granted. Both runtimes reach the host only through `dispatch`, so
 * there is one enforcement path.
 */
export class PermissionDispatcher {
  private readonly grants = new Map<string, ReadonlySet<PermissionString>>()

  /**
   * @param localApiPort The port of Jan's local API server right now, read
   *   per check so a changed setting applies at once. Nothing an extension
   *   is granted reaches it: it serves with the user's provider keys.
   */
  constructor(private readonly localApiPort: () => number | undefined = () => undefined) {}

  /** Replaces the grants of `extensionId`. */
  grant(extensionId: string, permissions: readonly PermissionString[]): void {
    this.grants.set(extensionId, new Set(permissions))
  }

  revokeAll(extensionId: string): void {
    this.grants.delete(extensionId)
  }

  /**
   * Whether `permission` is granted. A `network:<host>` request is matched
   * against every network grant, so `network:*.acme.dev` covers
   * `network:api.acme.dev`.
   */
  has(extensionId: string, permission: PermissionString): boolean {
    const granted = this.grants.get(extensionId)
    if (!granted) return false
    if (granted.has(permission)) return true
    const host = networkHostOf(permission)
    if (host === undefined) return false
    return [...granted].some((g) => {
      const grant = networkHostOf(g)
      return grant !== undefined && networkHostMatches(grant, host)
    })
  }

  /** Throws `E_PERMISSION` unless `permission` is granted. */
  check(extensionId: string, permission: PermissionString): void {
    if (!this.has(extensionId, permission)) {
      throw new ExtensionError(
        'E_PERMISSION',
        `Extension '${extensionId}' lacks the permission '${permission}'`
      )
    }
  }

  /** Throws `E_PERMISSION` unless some network grant allows `url`. */
  checkUrl(extensionId: string, url: string): void {
    const granted = this.grants.get(extensionId)
    const port = this.localApiPort()
    const allowed = [...(granted ?? [])].some((g) =>
      matchesNetwork(g, url, port)
    )
    if (!allowed) {
      let target = url
      try {
        const parsed = new URL(url)
        target = `${parsed.protocol}//${parsed.host}`
      } catch {
        // Reported as given.
      }
      throw new ExtensionError(
        'E_PERMISSION',
        `Extension '${extensionId}' may not connect to ${target}`
      )
    }
  }

  /**
   * Validates `args` against the method's policy, checks the grant, then
   * runs the host implementation. Validation comes first so a permission
   * check never sees arguments of the wrong shape. Synchronous methods
   * throw, async ones reject, as the public API documents.
   */
  dispatch<M extends HostMethod>(
    manifest: ValidatedManifest,
    api: HostApi,
    method: M,
    args: unknown[],
    call: CallOptions = {}
  ): HostResult<M> {
    const policy: MethodPolicy<M> = METHOD_POLICY[method]
    const parsed = policy.args.safeParse(args)
    if (!parsed.success) {
      throw new ExtensionError(
        'E_INVALID_ARGS',
        `Invalid arguments for '${method}': ${z.prettifyError(parsed.error)}`
      )
    }
    const { permission } = policy
    if (typeof permission === 'function')
      permission(parsed.data, manifest, this)
    else if (permission !== 'implicit') this.check(manifest.id, permission)
    const impl = api[method] as (
      call: CallOptions,
      ...a: HostArgs<M>
    ) => HostResult<M>
    return impl(call, ...parsed.data)
  }
}
