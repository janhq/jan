import { atom } from 'jotai'

export const migrationProgressStatusListAtom = atom<MigrationProgressStatus[]>(
  []
)

export const initMigrationAtom = atom(null, (_get, set) => {
  const migrationList: MigrationProgressStatus[] = [
    {
      migrationType: 'models',
      state: 'idle',
    },
    {
      migrationType: 'threads',
      state: 'idle',
    },
    {
      migrationType: 'init-engines',
      state: 'idle',
    },
    {
      migrationType: 'remote-engines',
      state: 'idle',
    },
  ]

  set(migrationProgressStatusListAtom, migrationList)
})

export const cleanUpMigrationAtom = atom(null, (_get, set) => {
  set(migrationProgressStatusListAtom, [])
})

export const startMigrationAtom = atom(
  null,
  (get, set, migrationType: MigrationType) => {
    // if is in progress, ignore
    const migrationProgressStatusList = get(migrationProgressStatusListAtom)
    if (
      migrationProgressStatusList.find(
        (e) => e.migrationType === migrationType && e.state === 'in_progress'
      )
    ) {
      console.debug('Migration is in progress, ignore')
      return
    }

    const newList: MigrationProgressStatus[] = migrationProgressStatusList.map(
      (e) =>
        e.migrationType === migrationType ? { ...e, state: 'in_progress' } : e
    )
    set(migrationProgressStatusListAtom, newList)
  }
)

export const setMigrationSuccessAtom = atom(
  null,
  (_get, set, migrationType: MigrationType) => {
    set(migrationProgressStatusListAtom, (prev) =>
      prev.map((e) =>
        e.migrationType === migrationType ? { ...e, state: 'success' } : e
      )
    )
  }
)

export const setMigrationFailedAtom = atom(
  null,
  (_get, set, migrationType: MigrationType) => {
    set(migrationProgressStatusListAtom, (prev) =>
      prev.map((e) =>
        e.migrationType === migrationType ? { ...e, state: 'failed' } : e
      )
    )
  }
)

export const MigrationStates = [
  'idle',
  'in_progress',
  'failed',
  'success',
] as const
export type MigrationState = (typeof MigrationStates)[number]

export const AllMigrationType = [
  'models',
  'threads',
  'init-engines',
  'remote-engines',
] as const
export type MigrationType = (typeof AllMigrationType)[number]

export type MigrationProgressStatus = {
  migrationType: MigrationType
  state: MigrationState
}
