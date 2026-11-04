import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SRC = resolve(__dirname, '../..')
const LOCALES_ROOT = resolve(__dirname, '..')

/** Namespaces whose keys are asserted to exist. */
const GUARDED_NAMESPACES = ['setup', 'model-errors', 'common', 'chat', 'tools']

/**
 * Namespaces every shipped locale must translate in full. The runtime falls
 * back to English for a missing key, so a gap never breaks the UI; it just
 * leaves a block of English inside an otherwise translated screen. Add a
 * namespace here once every locale has caught up with it.
 */
const COMPLETE_NAMESPACES = ['tools']

/**
 * Keys the code composes at runtime (`t(`setup:${stage.messageKey}`)`), which a
 * static scan cannot see. Listed explicitly so a renamed key still fails here
 * rather than silently rendering the key to the user.
 */
const DYNAMIC_KEYS: Record<string, string[]> = {
  setup: [
    'stageModel',
    'stageConsent',
    'checkModelResolving',
    'checkModelWaiting',
    'checkModelDownloading',
    'checkModelReady',
    'checkSystemGpu',
    'checkSystemGpuNoDriver',
    'checkSystemCpuOnly',
    'checkSystemFailed',
    'checkEnginePreparing',
    'checkEngineGpu',
    'checkEngineCpu',
    'checkEngineGpuUnused',
    'checkEngineVendorMismatch',
    'checkEngineRuntimeUnreachable',
    'checkEngineMissingLibrary',
    'checkEngineProbeFailed',
    'checkEngineUnavailable',
    'checkSearchPreparing',
    'checkSearchReady',
    'checkSearchNoVector',
    'checkSearchInvalidVector',
    'checkSearchProbeFailed',
    'checkSearchUnavailable',
  ],
  common: [
    // CoworkEmptyState picks its example set by whether a folder is attached.
    'coworkEmpty.sandbox.first',
    'coworkEmpty.sandbox.second',
    'coworkEmpty.sandbox.third',
    'coworkEmpty.folder.first',
    'coworkEmpty.folder.second',
    'coworkEmpty.folder.third',
  ],
  'model-errors': [
    'engine.unknown',
    'engine.MODEL_LOAD_FAILED',
    'engine.MODEL_ARCH_NOT_SUPPORTED',
    'engine.MODEL_LOAD_TIMED_OUT',
    'engine.MISSING_SHARED_LIBRARY',
    'engine.GPU_DRIVER_TOO_OLD',
    'engine.OUT_OF_MEMORY',
    'engine.MODEL_DOES_NOT_FIT',
    'engine.ENGINE_STOPPED',
    'engine.ENGINE_UNREACHABLE',
    'engine.UNSUPPORTED_CPU',
    'engine.INVALID_ARGUMENT',
    'engine.IO_ERROR',
    'engine.INTERNAL_ERROR',
  ],
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'locales') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc)
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      acc.push(full)
    }
  }
  return acc
}

function loadNamespace(
  namespace: string,
  locale = 'en'
): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(LOCALES_ROOT, locale, `${namespace}.json`), 'utf8')
  )
}

/** Every leaf of a bundle as `[dotted.key, value]`. */
function leaves(
  bundle: Record<string, unknown>,
  prefix = ''
): Array<[string, unknown]> {
  return Object.entries(bundle).flatMap(([key, value]) =>
    value && typeof value === 'object'
      ? leaves(value as Record<string, unknown>, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value] as [string, unknown]]
  )
}

/**
 * The `{{name}}` interpolations in a string, order-insensitive. Same pattern
 * as the runtime in i18n/setup.ts, so `{{ tool }}` (which it renders
 * literally) counts as a dropped placeholder.
 */
function placeholders(value: unknown): string[] {
  return typeof value === 'string'
    ? [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
    : []
}

const TRANSLATED_LOCALES = readdirSync(LOCALES_ROOT).filter(
  (entry) =>
    entry !== 'en' &&
    !entry.startsWith('__') &&
    statSync(join(LOCALES_ROOT, entry)).isDirectory()
)

function lookup(bundle: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object' && part in node) {
      return (node as Record<string, unknown>)[part]
    }
    return undefined
  }, bundle)
}

/**
 * A count-aware key lives in the bundle as `_one`/`_other`, never under its own
 * name, so i18next can pick the form. Without this, the only way to satisfy the
 * scan is to drop the `common:` prefix and fall out of it entirely.
 */
function resolveKey(bundle: Record<string, unknown>, key: string): boolean {
  return (
    lookup(bundle, key) !== undefined ||
    (lookup(bundle, `${key}_one`) !== undefined &&
      lookup(bundle, `${key}_other`) !== undefined)
  )
}

/** Literal `'<ns>:<key>'` occurrences, which is how keys are normally written. */
function referencedKeys(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>(
    GUARDED_NAMESPACES.map((ns) => [ns, new Set<string>()])
  )
  const pattern = new RegExp(
    `['"\`](${GUARDED_NAMESPACES.join('|')}):([A-Za-z0-9_.]+)['"\`]`,
    'g'
  )

  for (const file of sourceFiles(SRC)) {
    const content = readFileSync(file, 'utf8')
    for (const match of content.matchAll(pattern)) {
      found.get(match[1])!.add(match[2])
    }
  }
  return found
}

describe('en locale keys', () => {
  it.each(GUARDED_NAMESPACES)(
    'has every statically referenced %s key',
    (namespace) => {
      const bundle = loadNamespace(namespace)
      const missing = [...referencedKeys().get(namespace)!].filter(
        (key) => !resolveKey(bundle, key)
      )
      expect(missing, `missing from ${namespace}.json`).toEqual([])
    }
  )

  it.each(Object.keys(DYNAMIC_KEYS))(
    'has every runtime-composed %s key',
    (namespace) => {
      const bundle = loadNamespace(namespace)
      const missing = DYNAMIC_KEYS[namespace].filter(
        (key) => !resolveKey(bundle, key)
      )
      expect(missing, `missing from ${namespace}.json`).toEqual([])
    }
  )

  // A key left in the file but referenced nowhere is the state setup.json was
  // in before this work: ten strings kept in every locale for a screen that no
  // longer existed.
  it('has no unreferenced setup keys', () => {
    const bundle = loadNamespace('setup')
    const referenced = referencedKeys().get('setup')!
    const dynamic = new Set(DYNAMIC_KEYS.setup)

    const unused = Object.keys(bundle).filter(
      (key) => !referenced.has(key) && !dynamic.has(key)
    )
    expect(unused).toEqual([])
  })
})

describe.each(COMPLETE_NAMESPACES)('translated %s locales', (namespace) => {
  const english = leaves(loadNamespace(namespace))

  it('finds the translated locales', () => {
    expect(TRANSLATED_LOCALES.length).toBeGreaterThan(0)
  })

  it.each(TRANSLATED_LOCALES)('%s has every en key', (locale) => {
    const bundle = loadNamespace(namespace, locale)
    const missing = english
      .map(([key]) => key)
      .filter((key) => lookup(bundle, key) === undefined)
    expect(missing, `missing from ${locale}/${namespace}.json`).toEqual([])
  })

  // A key dropped from en, or a typo'd one, would otherwise linger unseen in
  // every translated file.
  it.each(TRANSLATED_LOCALES)('%s has no keys en lacks', (locale) => {
    const known = new Set(english.map(([key]) => key))
    const extra = leaves(loadNamespace(namespace, locale))
      .map(([key]) => key)
      .filter((key) => !known.has(key))
    expect(extra, `not in en/${namespace}.json`).toEqual([])
  })

  // A translated string that drops or renames `{{tool}}` renders a sentence
  // with a hole in it, or the literal braces, in that language only.
  it.each(TRANSLATED_LOCALES)('%s keeps every en placeholder', (locale) => {
    const bundle = loadNamespace(namespace, locale)
    const mismatched = english
      .filter(([key]) => lookup(bundle, key) !== undefined)
      .filter(
        ([key, value]) =>
          placeholders(lookup(bundle, key)).join() !==
          placeholders(value).join()
      )
      .map(([key]) => key)
    expect(
      mismatched,
      `placeholders differ in ${locale}/${namespace}.json`
    ).toEqual([])
  })
})

/**
 * The unified conversation surface (sidebar, Plan, workspace folder, conversation
 * scope, home project menu, Artifacts) must read as one language in every shipped
 * locale. `common` as a whole still has untranslated blocks, so these groups are
 * guarded on their own: present, same placeholders, and not left as English.
 */
const UNIFIED_UI_GROUPS = [
  'planMode',
  'workspace',
  'conversationScope',
  'homeMode',
  'sidebar',
]
const UNIFIED_UI_KEYS = [
  'artifacts',
  'skills',
  'chatsAndTasks',
  'deleteSession',
  'deleteSessionTitle',
  'deleteSessionBody',
  'web_search',
  'moreControls',
  'browse',
  'projects.viewProject',
  ...[
    'artifactGroupCode',
    'artifactGroupImage',
    'artifactGroupDocument',
    'artifactGroupVideo',
    'artifactGroupAudio',
    'artifactOpenPreview',
    'artifactOpenExternal',
    'artifactMoreActions',
    'artifactShowInFolder',
    'artifactsAll',
    'artifactsEmpty',
    'artifactsNoMatch',
    'artifactsLibraryDescription',
    'artifactsLibraryFiles',
    'artifactsLibraryCount_one',
    'artifactsLibraryCount_other',
    'artifactsLibraryFilter',
    'artifactsLibraryReset',
    'artifactsSearch',
    'artifactsShowMore',
  ],
]
/**
 * Words that are genuinely identical to English in some languages (loanwords,
 * product terms). Anything else equal to English is an untranslated copy.
 */
const SAME_AS_ENGLISH_OK: Record<string, string[]> = {
  ca: ['shell', 'artifactGroupDocument'],
  cs: ['shell', 'artifactGroupVideo', 'artifactGroupAudio'],
  'de-DE': [
    'shell',
    'skills',
    'artifactGroupCode',
    'artifactGroupVideo',
    'artifactGroupAudio',
    'planMode.label',
    'sidebar.navigation',
  ],
  es: ['shell', 'artifactGroupAudio', 'planMode.label'],
  fr: [
    'shell',
    'artifactGroupCode',
    'artifactGroupImage',
    'artifactGroupDocument',
    'artifactGroupAudio',
    'planMode.label',
    'sidebar.navigation',
  ],
  id: ['shell', 'artifactGroupVideo', 'artifactGroupAudio', 'artifactsLibraryCount_one'],
  it: ['shell', 'artifactGroupVideo', 'artifactGroupAudio', 'artifactsLibraryCount_one'],
  pl: ['artifactGroupAudio', 'planMode.label'],
  'pt-BR': ['shell'],
  vn: ['shell', 'artifactGroupVideo'],
  'zh-CN': ['shell'],
  'zh-TW': ['shell'],
}

describe('unified UI locale contract', () => {
  const english = leaves(loadNamespace('common'))
  const unifiedEnglish = english.filter(
    ([key]) =>
      UNIFIED_UI_GROUPS.some((group) => key.startsWith(`${group}.`)) ||
      UNIFIED_UI_KEYS.includes(key)
  )

  it('covers the unified groups', () => {
    for (const group of UNIFIED_UI_GROUPS) {
      expect(unifiedEnglish.some(([key]) => key.startsWith(`${group}.`))).toBe(true)
    }
    for (const key of UNIFIED_UI_KEYS) {
      expect(unifiedEnglish.map(([k]) => k)).toContain(key)
    }
  })

  it('no longer describes Artifacts as Cowork runs', () => {
    for (const locale of ['en', ...TRANSLATED_LOCALES]) {
      const bundle = loadNamespace('common', locale)
      expect(String(lookup(bundle, 'artifactsEmpty'))).not.toMatch(/cowork/i)
    }
  })

  it.each(TRANSLATED_LOCALES)('%s translates every unified UI key', (locale) => {
    const bundle = loadNamespace('common', locale)
    const missing = unifiedEnglish
      .map(([key]) => key)
      .filter((key) => lookup(bundle, key) === undefined)
    expect(missing, `missing from ${locale}/common.json`).toEqual([])

    const mismatched = unifiedEnglish
      .filter(
        ([key, value]) =>
          placeholders(lookup(bundle, key)).join() !== placeholders(value).join()
      )
      .map(([key]) => key)
    expect(mismatched, `placeholders differ in ${locale}`).toEqual([])

    const allowed = new Set(SAME_AS_ENGLISH_OK[locale] ?? [])
    const copied = unifiedEnglish
      .filter(([key, value]) => lookup(bundle, key) === value)
      .map(([key]) => key)
      .filter((key) => !allowed.has(key))
    expect(copied, `English copied into ${locale}/common.json`).toEqual([])
  })

  it('keeps the non-tool warning short', () => {
    for (const key of ['conversationScope.unsupported', 'conversationScope.folderUnsupported']) {
      expect(String(lookup(loadNamespace('common'), key)).length).toBeLessThan(130)
    }
  })
})

describe('locale placeholder parity', () => {
  const english = leaves(loadNamespace('common'))

  it.each(TRANSLATED_LOCALES)(
    '%s keeps the interpolation variables of every translated common key',
    (locale) => {
      const bundle = loadNamespace('common', locale)
      const mismatched = english
        .filter(([key]) => typeof lookup(bundle, key) === 'string')
        .filter(
          ([key, value]) =>
            placeholders(lookup(bundle, key)).join() !== placeholders(value).join()
        )
        .map(([key]) => key)
      expect(mismatched, `placeholders differ in ${locale}/common.json`).toEqual([])
    }
  )

  it.each([
    ['toast.modelValidationStarted.description', ['modelId']],
    ['toast.downloadComplete.description', ['item']],
  ])('%s uses %j in every locale', (key, expected) => {
    for (const locale of ['en', ...TRANSLATED_LOCALES]) {
      const value = lookup(loadNamespace('common', locale), key)
      expect(placeholders(value), `${locale}: ${String(value)}`).toEqual(expected)
    }
  })
})
