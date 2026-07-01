import { useMemo } from 'react'
import { IconTrash, IconPlus, IconAlertTriangle } from '@tabler/icons-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  paramsSettings,
  paramGroups,
  paramCategories,
  evaluateDisabled,
  isGroupedParamKey,
  type ParamDef,
  type ParamGroup,
} from '@/lib/predefinedParams'
import {
  paramsForProviders,
  resolveProviderCaps,
  isModelLevelRejected,
} from '@/lib/providerCaps'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { useTranslation } from '@/i18n/react-i18next-compat'

export interface ParametersSectionProps {
  params: Record<string, unknown>
  providers: Array<Pick<ProviderObject, 'provider'>>
  onToggle: (def: ParamDef) => void
  onChange: (key: string, value: unknown) => void
  onRemove: (key: string) => void
  /** Bulk add (used when adding a coupled group). */
  onAddMany?: (values: Record<string, unknown>) => void
  /** Bulk remove (used when removing a coupled group). */
  onRemoveMany?: (keys: string[]) => void
  /** When set, params model-rejected by (providerId, modelId) are flagged
   *  in active rows and hidden from the add menu. Pass from the composer
   *  where the selected model is known; omit in the assistant editor. */
  providerId?: string
  modelId?: string
}

export function ParametersSection({
  params,
  providers,
  onToggle,
  onChange,
  onRemove,
  onAddMany,
  onRemoveMany,
  providerId,
  modelId,
}: ParametersSectionProps) {
  const { t } = useTranslation()
  const modelRejects = (key: string) =>
    !!(providerId && modelId && isModelLevelRejected(key, providerId, modelId))
  const supportIndex = useMemo(() => {
    const idx: Record<
      string,
      { supportedBy: string[]; maybeBy: string[]; known: boolean }
    > = {}
    for (const def of Object.values(paramsSettings)) {
      idx[def.key] = { supportedBy: [], maybeBy: [], known: false }
    }
    for (const entry of paramsForProviders(providers)) {
      idx[entry.def.key] = {
        supportedBy: entry.supportedBy,
        maybeBy: entry.maybeBy,
        known: true,
      }
    }
    return idx
  }, [providers])

  const activeKeys = Object.keys(params)
  const activeGroups = paramGroups.filter((g) =>
    g.members.some((k) => k in params)
  )
  const activeStandaloneKeys = activeKeys
    .filter((k) => k in paramsSettings && !isGroupedParamKey(k))
    .sort((a, b) => canonicalOrder(a) - canonicalOrder(b))
  const unknownKeys = activeKeys.filter((k) => !(k in paramsSettings))

  const addStandalone = (def: ParamDef) => onToggle(def)
  const addGroup = (group: ParamGroup) => {
    if (onAddMany) {
      const defaults: Record<string, unknown> = {}
      for (const memberKey of group.members) {
        const def = paramsSettings[memberKey]
        if (!def) continue
        defaults[memberKey] =
          memberKey === group.triggerKey ? group.triggerValue : def.value
      }
      onAddMany(defaults)
    } else {
      for (const memberKey of group.members) {
        const def = paramsSettings[memberKey]
        if (!def) continue
        if (memberKey in params) continue
        onChange(
          memberKey,
          memberKey === group.triggerKey ? group.triggerValue : def.value
        )
      }
    }
  }
  const removeGroup = (group: ParamGroup) => {
    const keys = group.members.filter((k) => k in params)
    if (onRemoveMany) onRemoveMany(keys)
    else keys.forEach(onRemove)
  }

  const hasAny = activeGroups.length + activeStandaloneKeys.length > 0

  return (
    <div className="space-y-3">
      {!hasAny && (
        <div className="text-xs text-muted-foreground py-2">
          {t('assistants:noParameter')}
        </div>
      )}

      {activeStandaloneKeys.map((key) => (
        <StandaloneRow
          key={key}
          paramKey={key}
          params={params}
          support={supportIndex[key]}
          modelRejected={modelRejects(key)}
          onChange={onChange}
          onRemove={onRemove}
        />
      ))}

      {activeGroups.map((group) => (
        <GroupBlock
          key={group.id}
          group={group}
          params={params}
          onChange={onChange}
          onRemoveGroup={() => removeGroup(group)}
        />
      ))}

      {unknownKeys.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {unknownKeys.length} unrecognized parameter
          {unknownKeys.length === 1 ? '' : 's'} hidden:{' '}
          {unknownKeys.join(', ')}
        </div>
      )}

      <AddParameterMenu
        params={params}
        providers={providers}
        onAddStandalone={addStandalone}
        onAddGroup={addGroup}
        modelRejects={modelRejects}
      />
    </div>
  )
}

interface StandaloneRowProps {
  paramKey: string
  params: Record<string, unknown>
  support?: { supportedBy: string[]; maybeBy: string[]; known: boolean }
  modelRejected?: boolean
  onChange: (key: string, value: unknown) => void
  onRemove: (key: string) => void
}

function StandaloneRow({
  paramKey,
  params,
  support,
  modelRejected,
  onChange,
  onRemove,
}: StandaloneRowProps) {
  const def = paramsSettings[paramKey]
  if (!def) return null
  const disabledReason = evaluateDisabled(def, params)
  const value = params[paramKey] ?? def.value
  const capUnsupported =
    support && def.capability !== 'core' && def.capability !== 'client_only' && !support.known
  const unsupported = modelRejected || capUnsupported
  const maybeOnly =
    !modelRejected &&
    support &&
    support.known &&
    support.supportedBy.length === 0 &&
    support.maybeBy.length > 0
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1 min-w-0 flex-1 text-sm">
          <span className="truncate">{def.title}</span>
          {unsupported && (
            <IconAlertTriangle
              size={12}
              className="text-destructive shrink-0"
              aria-label="Not supported — will be stripped on send"
            />
          )}
          {!unsupported && maybeOnly && (
            <IconAlertTriangle
              size={12}
              className="text-amber-500 shrink-0"
              aria-label="May be ignored by this provider"
            />
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onRemove(paramKey)}
          className="shrink-0 h-7 w-7"
          aria-label={`Remove ${def.title}`}
        >
          <IconTrash size={14} className="text-destructive" />
        </Button>
      </div>
      <DynamicControllerSetting
        controllerType={def.controllerType}
        controllerProps={{
          value: value as string | number | boolean,
          ...(def.controllerProps ?? {}),
        }}
        disabledReason={disabledReason ?? undefined}
        onChange={(v) => onChange(paramKey, v)}
      />
      {(unsupported || def.effectHint) && (
        <div
          className={
            unsupported
              ? 'text-xs text-destructive'
              : 'text-xs text-muted-foreground'
          }
        >
          {unsupported ? 'Not supported — will be skipped.' : def.effectHint}
        </div>
      )}
    </div>
  )
}

interface GroupBlockProps {
  group: ParamGroup
  params: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  onRemoveGroup: () => void
}

function GroupBlock({
  group,
  params,
  onChange,
  onRemoveGroup,
}: GroupBlockProps) {
  return (
    <div className="rounded-md border border-border/60 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">{group.title}</div>
          <div className="text-xs text-muted-foreground">{group.description}</div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onRemoveGroup}
          aria-label={`Remove ${group.title}`}
        >
          <IconTrash size={16} className="text-destructive" />
        </Button>
      </div>
      <div className="space-y-2 pl-2 border-l border-border/40">
        {group.members
          .filter((k) => k in params)
          .map((memberKey) => {
            const def = paramsSettings[memberKey]
            if (!def) return null
            const disabledReason = evaluateDisabled(def, params)
            const value = params[memberKey] ?? def.value
            return (
              <div key={memberKey} className="space-y-1">
                <div className="text-xs text-muted-foreground">{def.title}</div>
                <DynamicControllerSetting
                  controllerType={def.controllerType}
                  controllerProps={{
                    value: value as string | number | boolean,
                    ...(def.controllerProps ?? {}),
                  }}
                  disabledReason={disabledReason ?? undefined}
                  onChange={(v) => onChange(memberKey, v)}
                />
              </div>
            )
          })}
      </div>
    </div>
  )
}

interface AddParameterMenuProps {
  params: Record<string, unknown>
  providers: Array<Pick<ProviderObject, 'provider'>>
  onAddStandalone: (def: ParamDef) => void
  onAddGroup: (group: ParamGroup) => void
  modelRejects: (key: string) => boolean
}

function AddParameterMenu({
  params,
  providers,
  onAddStandalone,
  onAddGroup,
  modelRejects,
}: AddParameterMenuProps) {
  const { t } = useTranslation()
  const items = useMemo(() => {
    return paramCategories
      .map((cat) => {
        const standalone = cat.paramKeys
          .map((k) => paramsSettings[k])
          .filter((def): def is ParamDef => Boolean(def))
          .filter((def) => isCapabilitySupported(def, providers))
          .filter((def) => !modelRejects(def.key))
          .map((def) => ({
            kind: 'param' as const,
            def,
            active: def.key in params,
            support: providerSupportFor(def, providers),
          }))
        const groups = cat.groupIds
          .map((id) => paramGroups.find((g) => g.id === id))
          .filter((g): g is ParamGroup => Boolean(g))
          .filter((g) => isGroupCapabilitySupported(g, providers))
          .map((g) => ({
            kind: 'group' as const,
            group: g,
            active: g.members.some((k) => k in params),
          }))
        const entries = [...standalone, ...groups]
        return { cat, entries }
      })
      .filter(({ entries }) => entries.length > 0)
  }, [params, providers, modelRejects])

  if (items.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        {t('assistants:noTunableParams')}
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-start">
          <IconPlus size={14} className="mr-1" />
          {t('assistants:addParameter')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 max-h-[60vh] overflow-y-auto">
        {items.map(({ cat, entries }, catIdx) => (
          <div key={cat.id}>
            {catIdx > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {cat.title}
            </DropdownMenuLabel>
            {entries.map((entry) =>
              entry.kind === 'param' ? (
                <DropdownMenuItem
                  key={`p:${entry.def.key}`}
                  disabled={entry.active}
                  onSelect={() => onAddStandalone(entry.def)}
                  className="flex flex-col items-start gap-0.5 py-1.5"
                >
                  <div className="flex items-center gap-1 w-full">
                    <span className="text-sm">{entry.def.title}</span>
                    {entry.support.supportedBy.length === 0 &&
                      entry.support.maybeBy.length > 0 && (
                        <IconAlertTriangle
                          size={11}
                          className="text-amber-500 ml-auto"
                        />
                      )}
                  </div>
                  <span className="text-xs text-muted-foreground line-clamp-1">
                    {entry.def.effectHint ?? entry.def.description}
                  </span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  key={`g:${entry.group.id}`}
                  disabled={entry.active}
                  onSelect={() => onAddGroup(entry.group)}
                  className="flex flex-col items-start gap-0.5 py-1.5"
                >
                  <span className="text-sm">{entry.group.title}</span>
                  <span className="text-xs text-muted-foreground line-clamp-1">
                    {entry.group.description}
                  </span>
                </DropdownMenuItem>
              )
            )}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Stable display order for active rows: same order the Add menu uses
 * (categories top-to-bottom, items within a category in declared order).
 * Unknown / category-less keys sort to the end, preserving relative order.
 */
const CANONICAL_INDEX: Record<string, number> = (() => {
  const idx: Record<string, number> = {}
  let i = 0
  for (const cat of paramCategories) {
    for (const key of cat.paramKeys) {
      if (!(key in idx)) idx[key] = i++
    }
  }
  return idx
})()

function canonicalOrder(key: string): number {
  return key in CANONICAL_INDEX ? CANONICAL_INDEX[key] : Number.MAX_SAFE_INTEGER
}

function providerSupportFor(
  def: ParamDef,
  providers: Array<Pick<ProviderObject, 'provider'>>
): { supportedBy: string[]; maybeBy: string[] } {
  const supportedBy: string[] = []
  const maybeBy: string[] = []
  for (const p of providers) {
    const caps = resolveProviderCaps(p)
    if (caps.supported.has(def.capability)) supportedBy.push(p.provider)
    else if (caps.maybe.has(def.capability)) maybeBy.push(p.provider)
  }
  return { supportedBy, maybeBy }
}

function isCapabilitySupported(
  def: ParamDef,
  providers: Array<Pick<ProviderObject, 'provider'>>
): boolean {
  if (def.capability === 'client_only' || def.capability === 'core') return true
  return providers.some((p) => {
    const caps = resolveProviderCaps(p)
    return caps.supported.has(def.capability) || caps.maybe.has(def.capability)
  })
}

function isGroupCapabilitySupported(
  group: ParamGroup,
  providers: Array<Pick<ProviderObject, 'provider'>>
): boolean {
  return providers.some((p) => {
    const caps = resolveProviderCaps(p)
    return caps.supported.has(group.capability) || caps.maybe.has(group.capability)
  })
}
