import type {
  Contributions,
  MenuLocation,
  SettingContribution,
  WhenClause,
} from './contributions.js'
import type {
  ManifestError,
  ProposalName,
  ValidatedManifest,
  ValidationResult,
} from './manifest.js'
import {
  isLocalHost,
  isPermissionString,
  networkHostMatches,
  networkHostOf,
  type PermissionString,
} from './permissions.js'
import { isCaretRange, isSemver } from './semver.js'

type Obj = Record<string, unknown>

const ID = /^[a-z0-9][a-z0-9-]{1,38}\.[a-z0-9][a-z0-9-]{1,38}$/
const L10N_REF = /^%([A-Za-z0-9_.-]+)%$/
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const CONTRIBUTION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/**
 * The grammar of a command, status item or provider id and of a tool name:
 * up to 64 letters, digits, `.`, `_` and `-`, starting with a letter or
 * digit. Hosts look contributions up by these ids, so none of them can be
 * `__proto__`; names such as `constructor` stay valid and hosts must look
 * them up as own properties.
 */
export function isContributionId(value: unknown): value is string {
  return typeof value === 'string' && CONTRIBUTION_ID.test(value)
}

const MANIFEST_KEYS = [
  'id',
  'displayName',
  'description',
  'publisher',
  'apiVersion',
  'main',
  'permissions',
  'proposals',
  'contributes',
  'l10n',
]
const CONTRIBUTION_KEYS = [
  'settings',
  'commands',
  'menus',
  'statusItems',
  'tools',
  'providers',
]
const MENU_LOCATIONS: readonly MenuLocation[] = [
  'commandPalette',
  'thread/context',
  'message/actions',
  'chatInput/actions',
]
const WHEN_CLAUSES: readonly WhenClause[] = [
  'always',
  'message.role == assistant',
  'message.role == user',
  'thread.hasMessages',
]
const PROPOSALS: readonly ProposalName[] = ['chat']
const INPUT_TYPES = ['text', 'url', 'number']

const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0
const key = (base: string, k: string) => {
  if (!IDENTIFIER.test(k)) return `${base}['${k}']`
  return base ? `${base}.${k}` : k
}

/**
 * Collects every problem rather than stopping at the first one, so an author
 * fixes a manifest in one pass. Field checks run in manifest order, which
 * keeps the error list stable for tests and for the install UI.
 */
class Checker {
  readonly errors: ManifestError[] = []

  fail(path: string, message: string): false {
    this.errors.push({ path, message })
    return false
  }

  string(
    obj: Obj,
    field: string,
    path: string,
    opts: { optional?: boolean } = {}
  ): boolean {
    const value = obj[field]
    if (value === undefined && opts.optional) return true
    return (
      isNonEmptyString(value) ||
      this.fail(key(path, field), 'must be a non-empty string')
    )
  }

  number(
    obj: Obj,
    field: string,
    path: string,
    opts: { optional?: boolean } = {}
  ): boolean {
    const value = obj[field]
    if (value === undefined && opts.optional) return true
    return (
      (typeof value === 'number' && Number.isFinite(value)) ||
      this.fail(key(path, field), 'must be a number')
    )
  }

  known(obj: Obj, allowed: readonly string[], path: string): void {
    for (const k of Object.keys(obj)) {
      if (!allowed.includes(k)) this.fail(key(path, k), 'is not a known field')
    }
  }

  /** Runs `each` on every object element of `obj[field]`, if it is an array. */
  list(
    obj: Obj,
    field: string,
    path: string,
    each: (item: Obj, itemPath: string) => void
  ): void {
    const value = obj[field]
    if (value === undefined) return
    const listPath = key(path, field)
    if (!Array.isArray(value)) {
      this.fail(listPath, 'must be an array')
      return
    }
    value.forEach((item, i) => {
      const itemPath = `${listPath}[${i}]`
      if (isObj(item)) each(item, itemPath)
      else this.fail(itemPath, 'must be an object')
    })
  }

  /** A contribution id, see `isContributionId`. */
  contributionId(obj: Obj, field: string, path: string): boolean {
    if (!this.string(obj, field, path)) return false
    return (
      isContributionId(obj[field]) ||
      this.fail(
        key(path, field),
        'must be 1-64 letters, digits, dots, underscores or dashes, starting with a letter or digit'
      )
    )
  }

  /** Records a duplicate of `obj[field]` within one list. */
  unique(seen: Set<string>, obj: Obj, field: string, path: string): void {
    const value = obj[field]
    if (typeof value !== 'string') return
    if (seen.has(value)) this.fail(key(path, field), `duplicates '${value}'`)
    seen.add(value)
  }
}

function checkMain(c: Checker, main: unknown): void {
  const path = 'jan.main'
  if (!isNonEmptyString(main)) {
    c.fail(path, 'must be a non-empty string')
    return
  }
  const relative = main.startsWith('./') ? main.slice(2) : main
  const segments = relative.split('/')
  // Rejects absolute paths, drive letters, backslashes and any `.`/`..`
  // segment, so the entry always resolves inside the package directory.
  const escapes =
    main.includes('\\') ||
    main.includes(':') ||
    segments.some((s) => s === '' || s === '.' || s === '..')
  if (escapes) c.fail(path, 'must be a relative path inside the package')
  else if (!relative.endsWith('.js')) c.fail(path, 'must point at a .js file')
}

function checkPermissions(c: Checker, value: unknown): PermissionString[] {
  if (!Array.isArray(value)) {
    c.fail('jan.permissions', 'must be an array')
    return []
  }
  const valid: PermissionString[] = []
  value.forEach((p, i) => {
    const path = `jan.permissions[${i}]`
    if (typeof p !== 'string' || !isPermissionString(p))
      c.fail(path, 'is not a known permission')
    else if (valid.includes(p)) c.fail(path, `duplicates '${p}'`)
    else valid.push(p)
  })
  return valid
}

function checkProposals(c: Checker, value: unknown): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    c.fail('jan.proposals', 'must be an array')
    return
  }
  value.forEach((p, i) => {
    if (!PROPOSALS.includes(p as ProposalName))
      c.fail(`jan.proposals[${i}]`, 'is not a known proposal')
  })
}

function checkControl(c: Checker, control: unknown, path: string): void {
  if (!isObj(control)) {
    c.fail(path, 'must be an object')
    return
  }
  const def = control.default
  const defPath = `${path}.default`
  switch (control.type) {
    case 'input':
      c.known(control, ['type', 'inputType', 'placeholder', 'default'], path)
      if (
        control.inputType !== undefined &&
        !INPUT_TYPES.includes(control.inputType as string)
      )
        c.fail(`${path}.inputType`, `must be one of ${INPUT_TYPES.join(', ')}`)
      c.string(control, 'placeholder', path, { optional: true })
      if (typeof def !== 'string') c.fail(defPath, 'must be a string')
      return
    case 'textarea':
      c.known(control, ['type', 'rows', 'default'], path)
      c.number(control, 'rows', path, { optional: true })
      if (typeof def !== 'string') c.fail(defPath, 'must be a string')
      return
    case 'checkbox':
      c.known(control, ['type', 'default'], path)
      if (typeof def !== 'boolean') c.fail(defPath, 'must be a boolean')
      return
    case 'dropdown': {
      c.known(control, ['type', 'options', 'default'], path)
      const values: string[] = []
      c.list(control, 'options', path, (option, optionPath) => {
        c.known(option, ['value', 'label'], optionPath)
        if (c.string(option, 'value', optionPath))
          values.push(option.value as string)
        c.string(option, 'label', optionPath)
      })
      if (!Array.isArray(control.options) || control.options.length === 0)
        c.fail(`${path}.options`, 'must list at least one option')
      else if (typeof def !== 'string' || !values.includes(def))
        c.fail(defPath, 'must be one of the option values')
      return
    }
    case 'slider': {
      c.known(control, ['type', 'min', 'max', 'step', 'default'], path)
      const ok = [
        c.number(control, 'min', path),
        c.number(control, 'max', path),
        c.number(control, 'step', path),
        c.number(control, 'default', path),
      ].every(Boolean)
      if (!ok) return
      const { min, max, step } = control as {
        min: number
        max: number
        step: number
      }
      if (min > max || step <= 0)
        c.fail(path, 'needs min <= max and a positive step')
      else if ((def as number) < min || (def as number) > max)
        c.fail(defPath, 'must lie within min and max')
      return
    }
    default:
      c.fail(
        `${path}.type`,
        'must be input, textarea, checkbox, dropdown or slider'
      )
  }
}

function checkProviderUrl(
  c: Checker,
  value: unknown,
  path: string,
  permissions: PermissionString[]
): void {
  let url: URL
  try {
    url = new URL(value as string)
  } catch {
    c.fail(path, 'must be an absolute URL')
    return
  }
  const host = url.hostname
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && isLocalHost(host))
  ) {
    c.fail(
      path,
      'must use https (http is allowed only for localhost and 127.0.0.1)'
    )
    return
  }
  const granted = permissions.some((p) => {
    const grant = networkHostOf(p)
    return grant !== undefined && networkHostMatches(grant, host)
  })
  if (!granted) c.fail(path, `needs the permission network:${host}`)
}

function checkContributions(
  c: Checker,
  contributes: unknown,
  permissions: PermissionString[]
): void {
  const path = 'jan.contributes'
  if (contributes === undefined) return
  if (!isObj(contributes)) {
    c.fail(path, 'must be an object')
    return
  }
  c.known(contributes, CONTRIBUTION_KEYS, path)

  const settings = new Map<string, SettingContribution>()
  const settingKeys = new Set<string>()
  c.list(contributes, 'settings', path, (s, p) => {
    c.known(s, ['key', 'title', 'description', 'secret', 'control'], p)
    c.string(s, 'key', p)
    c.unique(settingKeys, s, 'key', p)
    c.string(s, 'title', p)
    c.string(s, 'description', p, { optional: true })
    if (s.secret !== undefined && typeof s.secret !== 'boolean')
      c.fail(`${p}.secret`, 'must be a boolean')
    // The OS keyring holds strings only.
    else if (
      s.secret &&
      isObj(s.control) &&
      s.control.type !== 'input' &&
      s.control.type !== 'textarea'
    )
      c.fail(`${p}.secret`, 'is only allowed on input and textarea controls')
    checkControl(c, s.control, `${p}.control`)
    if (typeof s.key === 'string' && !settings.has(s.key))
      settings.set(s.key, s as unknown as SettingContribution)
  })

  const commands = new Set<string>()
  c.list(contributes, 'commands', path, (cmd, p) => {
    c.known(cmd, ['id', 'title', 'category', 'icon'], p)
    c.contributionId(cmd, 'id', p)
    c.unique(commands, cmd, 'id', p)
    c.string(cmd, 'title', p)
    c.string(cmd, 'category', p, { optional: true })
    c.string(cmd, 'icon', p, { optional: true })
  })
  const commandRef = (obj: Obj, p: string) => {
    if (obj.command !== undefined && !commands.has(obj.command as string))
      c.fail(
        `${p}.command`,
        'must name a command declared in contributes.commands'
      )
  }

  const menus = contributes.menus
  if (menus !== undefined && !isObj(menus))
    c.fail(`${path}.menus`, 'must be an object')
  else if (menus !== undefined) {
    const menusPath = `${path}.menus`
    for (const location of Object.keys(menus)) {
      if (!MENU_LOCATIONS.includes(location as MenuLocation)) {
        c.fail(key(menusPath, location), 'is not a known menu location')
        continue
      }
      c.list(menus, location, menusPath, (item, p) => {
        c.known(item, ['command', 'when', 'group', 'order'], p)
        if (c.string(item, 'command', p)) commandRef(item, p)
        if (
          item.when !== undefined &&
          !WHEN_CLAUSES.includes(item.when as WhenClause)
        )
          c.fail(`${p}.when`, 'is not a known when clause')
        c.string(item, 'group', p, { optional: true })
        c.number(item, 'order', p, { optional: true })
      })
    }
  }

  const statusIds = new Set<string>()
  c.list(contributes, 'statusItems', path, (item, p) => {
    c.known(item, ['id', 'text', 'tooltip', 'command', 'priority'], p)
    c.contributionId(item, 'id', p)
    c.unique(statusIds, item, 'id', p)
    c.string(item, 'text', p)
    c.string(item, 'tooltip', p, { optional: true })
    if (item.command !== undefined && c.string(item, 'command', p))
      commandRef(item, p)
    c.number(item, 'priority', p, { optional: true })
  })

  if (contributes.tools !== undefined && !permissions.includes('tools'))
    c.fail(`${path}.tools`, "needs the permission 'tools'")
  const toolNames = new Set<string>()
  c.list(contributes, 'tools', path, (tool, p) => {
    c.known(tool, ['name', 'description', 'inputSchema'], p)
    c.contributionId(tool, 'name', p)
    c.unique(toolNames, tool, 'name', p)
    c.string(tool, 'description', p)
    if (!isObj(tool.inputSchema) || tool.inputSchema.type !== 'object')
      c.fail(`${p}.inputSchema`, "must be a JSON Schema with type 'object'")
  })

  if (contributes.providers !== undefined && !permissions.includes('providers'))
    c.fail(`${path}.providers`, "needs the permission 'providers'")
  const providerIds = new Set<string>()
  c.list(contributes, 'providers', path, (provider, p) => {
    c.known(provider, ['id', 'displayName', 'baseUrl', 'apiKeySetting'], p)
    c.contributionId(provider, 'id', p)
    c.unique(providerIds, provider, 'id', p)
    c.string(provider, 'displayName', p)
    if (c.string(provider, 'baseUrl', p))
      checkProviderUrl(c, provider.baseUrl, `${p}.baseUrl`, permissions)
    if (
      provider.apiKeySetting !== undefined &&
      c.string(provider, 'apiKeySetting', p)
    ) {
      const setting = settings.get(provider.apiKeySetting as string)
      if (!setting?.secret)
        c.fail(
          `${p}.apiKeySetting`,
          'must name a secret setting declared in contributes.settings'
        )
    }
  })
}

/** Paths of every user-visible string that may be a `%key%` reference. */
function* localizableStrings(jan: Obj): Generator<[string, unknown]> {
  yield ['jan.displayName', jan.displayName]
  yield ['jan.description', jan.description]
  const contributes = isObj(jan.contributes)
    ? (jan.contributes as Contributions)
    : {}
  const base = 'jan.contributes'
  for (const [i, s] of (contributes.settings ?? []).entries()) {
    yield [`${base}.settings[${i}].title`, s?.title]
    yield [`${base}.settings[${i}].description`, s?.description]
  }
  for (const [i, cmd] of (contributes.commands ?? []).entries()) {
    yield [`${base}.commands[${i}].title`, cmd?.title]
    yield [`${base}.commands[${i}].category`, cmd?.category]
  }
  for (const [i, item] of (contributes.statusItems ?? []).entries()) {
    yield [`${base}.statusItems[${i}].text`, item?.text]
    yield [`${base}.statusItems[${i}].tooltip`, item?.tooltip]
  }
  for (const [i, provider] of (contributes.providers ?? []).entries()) {
    yield [`${base}.providers[${i}].displayName`, provider?.displayName]
  }
}

function checkL10n(c: Checker, jan: Obj): void {
  const l10n = jan.l10n
  if (l10n !== undefined) {
    const valid =
      isObj(l10n) &&
      Object.values(l10n).every(
        (table) =>
          isObj(table) &&
          Object.values(table).every((v) => typeof v === 'string')
      )
    if (!valid) {
      c.fail('jan.l10n', 'must map locales to tables of strings')
      return
    }
  }
  const en = isObj(l10n) && isObj(l10n.en) ? l10n.en : {}
  // Lists are only walked when well-formed, so malformed entries reported
  // above do not also produce l10n noise.
  for (const [path, value] of localizableStrings(jan)) {
    const ref = typeof value === 'string' ? L10N_REF.exec(value) : null
    if (ref && !(ref[1] in en))
      c.fail(path, `references '${ref[1]}', which l10n.en does not define`)
  }
}

/**
 * Validates a whole package.json and returns its `jan` manifest together
 * with the package name, version and `engines.jan`. The same rules run in the
 * host at install and load time, so authors can lint with this function.
 */
export function validateManifest(pkg: unknown): ValidationResult {
  const c = new Checker()
  if (!isObj(pkg)) {
    c.fail('', 'package.json must be an object')
    return { ok: false, errors: c.errors }
  }
  c.string(pkg, 'name', '')
  if (typeof pkg.version !== 'string' || !isSemver(pkg.version))
    c.fail('version', 'must be a semver version')
  const engines = pkg.engines
  const janEngine = isObj(engines) ? engines.jan : undefined
  if (janEngine !== undefined && !isNonEmptyString(janEngine))
    c.fail('engines.jan', 'must be a version range')

  const jan = pkg.jan
  if (!isObj(jan)) {
    c.fail('jan', 'must be an object')
    return { ok: false, errors: c.errors }
  }
  c.known(jan, MANIFEST_KEYS, 'jan')
  if (typeof jan.id !== 'string' || !ID.test(jan.id))
    c.fail(
      'jan.id',
      "must be '<publisher>.<name>' in lowercase letters, digits and dashes"
    )
  c.string(jan, 'displayName', 'jan')
  c.string(jan, 'description', 'jan', { optional: true })
  c.string(jan, 'publisher', 'jan')
  if (typeof jan.apiVersion !== 'string' || !isCaretRange(jan.apiVersion))
    c.fail('jan.apiVersion', "must be a caret range such as '^1.0.0'")
  checkMain(c, jan.main)
  const permissions = checkPermissions(c, jan.permissions)
  checkProposals(c, jan.proposals)
  checkContributions(c, jan.contributes, permissions)
  checkL10n(c, jan)

  if (c.errors.length > 0) return { ok: false, errors: c.errors }
  const manifest = {
    ...structuredClone(jan),
    name: pkg.name,
    version: pkg.version,
    ...(typeof janEngine === 'string' ? { engines: { jan: janEngine } } : {}),
  } as ValidatedManifest
  return { ok: true, manifest }
}
