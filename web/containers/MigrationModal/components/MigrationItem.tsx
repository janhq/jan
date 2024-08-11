import { Button } from '@janhq/joi'

import GreenTick from '@/components/GreenTick'

import Spinner from '@/containers/Loader/Spinner'

import { MigrationState, MigrationType } from '@/helpers/atoms/Migration.atom'

type Props = {
  migrationType: MigrationType
  migrationState: MigrationState
  onRetryClicked: (migrationType: MigrationType) => void
}

const getMigrationTitle = (migrationType: MigrationType) => {
  switch (migrationType) {
    case 'models':
      return 'Migrating Local Models'
    case 'threads':
      return 'Migrating Threads'
    case 'init-engines':
      return 'Initializing Engines'
    case 'remote-engines':
      return 'Migrating Remote Engines'
    default:
      return 'Unknown migration type'
  }
}

const MigrationItem: React.FC<Props> = ({
  migrationType,
  migrationState,
  onRetryClicked,
}) => {
  const title = getMigrationTitle(migrationType)
  return (
    <div className="border-1 flex w-full flex-row items-center rounded-md border border-[hsla(var(--app-border))] px-2 py-1.5">
      <div className="flex-1">{title}</div>
      <MigrationStateIndicator
        migrationType={migrationType}
        migrationState={migrationState}
        onRetryClicked={onRetryClicked}
      />
    </div>
  )
}

const MigrationStateIndicator: React.FC<Props> = ({
  migrationType,
  migrationState,
  onRetryClicked,
}) => {
  if (migrationState === 'in_progress') {
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (migrationState === 'success') {
    return <GreenTick />
  }

  if (migrationState === 'failed') {
    return <Button onClick={() => onRetryClicked(migrationType)}>Retry</Button>
  }

  // default case, for idle state as well
  return <div />
}

export default MigrationItem
