import { useAtomValue } from 'jotai'

import MigrationItem from './MigrationItem'
import MigrationProgressBar from './MigrationProgressBar'

import {
  migrationProgressStatusListAtom,
  MigrationType,
} from '@/helpers/atoms/Migration.atom'

type Props = {
  onRetryClicked: (migrationType: MigrationType) => void
}

const MigrationInProgressContainer: React.FC<Props> = ({ onRetryClicked }) => {
  const migrationStatusList = useAtomValue(migrationProgressStatusListAtom)

  // TODO: think of how to set the percentage here
  const percentage = 0.8

  return (
    <div className="flex w-full flex-col">
      <MigrationProgressBar percentage={percentage} />
      <div className="flex flex-col gap-y-1">
        {migrationStatusList.map(({ migrationType, state }) => (
          <MigrationItem
            key={migrationType}
            migrationType={migrationType}
            onRetryClicked={onRetryClicked}
            migrationState={state}
          />
        ))}
      </div>
    </div>
  )
}

export default MigrationInProgressContainer
