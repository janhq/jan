/**
 * Zustand store holding the transient install / run state for the Launch page
 * integrations (busy, spinner, phase, install logs, detection results).
 *
 * This state used to live in `useState` inside `LaunchPage`, so navigating
 * away mid-install unmounted the component and dropped the in-flight progress;
 * the Rust installer kept running but the UI lost track of it and showed no
 * loader on return. Hoisting it into a module-level store lets it survive
 * route unmount/remount while still resetting on a full app reload (we
 * intentionally do NOT persist it to disk).
 *
 * Setters mimic React's `Dispatch<SetStateAction<T>>` so existing call sites
 * (`setBusy((prev) => ({ ...prev, [id]: true }))`) work unchanged.
 */

import { create } from 'zustand'

export type RunPhase = 'installing' | 'configuring' | undefined

type SetState<T> = (updater: T | ((prev: T) => T)) => void

function apply<T>(updater: T | ((prev: T) => T), prev: T): T {
  return typeof updater === 'function'
    ? (updater as (p: T) => T)(prev)
    : updater
}

type LaunchState = {
  installed: Record<string, boolean>
  busy: Record<string, boolean>
  spinning: Record<string, boolean>
  phase: Record<string, RunPhase>
  logs: Record<string, string[]>
  openLog: Record<string, boolean>
  setInstalled: SetState<Record<string, boolean>>
  setBusy: SetState<Record<string, boolean>>
  setSpinning: SetState<Record<string, boolean>>
  setPhase: SetState<Record<string, RunPhase>>
  setLogs: SetState<Record<string, string[]>>
  setOpenLog: SetState<Record<string, boolean>>
}

export const useLaunchStore = create<LaunchState>((set) => ({
  installed: {},
  busy: {},
  spinning: {},
  phase: {},
  logs: {},
  openLog: {},
  setInstalled: (updater) =>
    set((s) => ({ installed: apply(updater, s.installed) })),
  setBusy: (updater) => set((s) => ({ busy: apply(updater, s.busy) })),
  setSpinning: (updater) =>
    set((s) => ({ spinning: apply(updater, s.spinning) })),
  setPhase: (updater) => set((s) => ({ phase: apply(updater, s.phase) })),
  setLogs: (updater) => set((s) => ({ logs: apply(updater, s.logs) })),
  setOpenLog: (updater) =>
    set((s) => ({ openLog: apply(updater, s.openLog) })),
}))
