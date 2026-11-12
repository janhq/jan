import {
  IconAlertTriangle,
  IconCheck,
  IconCircleDashed,
  IconCpu,
  IconHelpCircle,
  IconX,
  type Icon,
} from '@tabler/icons-react'

import type { DeviceVerdict, DiagnosticsGroup } from '@/lib/diagnosticsGroups'

/**
 * The visual vocabulary for a hardware check.
 *
 * Deliberately the same shape and the same four colours as
 * `ModelInfoHoverCard`'s fit tiers -- a dot, a pill, an icon and a
 * plain-language label -- so a green dot means the same thing wherever a user
 * meets one in Jan. Amber is the interesting one here: an op the device does
 * not implement is not a fault, it is slower, and painting it red would send
 * people chasing a non-problem.
 */
export interface StatusStyle {
  icon: Icon
  dot: string
  pill: string
  /** Left edge of a device row; the hardware page uses the same device. */
  edge: string
  text: string
}

export const VERDICT_STYLES: Record<DeviceVerdict, StatusStyle> = {
  passed: {
    icon: IconCheck,
    dot: 'bg-emerald-500',
    pill: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    edge: 'border-l-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  fallback: {
    icon: IconCpu,
    dot: 'bg-amber-500',
    pill: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    edge: 'border-l-amber-500',
    text: 'text-amber-700 dark:text-amber-400',
  },
  // Nothing failed, but part of the check tested nothing. Neutral rather than
  // red -- there is no fault here -- but it carries an edge and an icon of its
  // own, because the one thing it must not look like is a pass.
  inconclusive: {
    icon: IconHelpCircle,
    dot: 'bg-neutral-400',
    pill: 'bg-secondary text-muted-foreground',
    edge: 'border-l-neutral-400',
    text: 'text-muted-foreground',
  },
  failed: {
    icon: IconX,
    dot: 'bg-red-500',
    pill: 'bg-red-500/10 text-red-600 dark:text-red-400',
    edge: 'border-l-red-500',
    text: 'text-red-600 dark:text-red-400',
  },
  unknown: {
    icon: IconCircleDashed,
    dot: 'bg-neutral-400',
    pill: 'bg-secondary text-muted-foreground',
    // No edge colour: a device that has not run carries no verdict, and an
    // absent border says that more honestly than a grey one.
    edge: 'border-l-transparent',
    text: 'text-muted-foreground',
  },
}

export const CRASH_STYLE: StatusStyle = {
  ...VERDICT_STYLES.failed,
  icon: IconAlertTriangle,
}

/** Locale keys for the group name and its one-line explanation. */
export function groupLabelKeys(group: DiagnosticsGroup): {
  label: string
  detail: string
} {
  const suffix = group.charAt(0).toUpperCase() + group.slice(1)
  return {
    label: `providers:diagnostics.group${suffix}`,
    detail: `providers:diagnostics.group${suffix}Detail`,
  }
}
