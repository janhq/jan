import { Fragment } from 'react'

import { Button } from '@janhq/joi'
import { AlertTriangleIcon } from 'lucide-react'

type Props = {
  onMigrateNowClick: () => void
}

const MigrationIntroContainer: React.FC<Props> = ({ onMigrateNowClick }) => {
  return (
    <Fragment>
      <p className="text-[hsla(var(--text-secondary))]">
        We&apos; ve upgraded <span className="font-bold">Jan x Cortex</span>,
        our new AI engine. This should improve performance and let us support
        more models easily.
      </p>
      <br />
      <p className="text-[hsla(var(--text-secondary))]">
        Read more about Cortex here{' '}
        <a
          className="text-[hsla(var(--app-link))]"
          target="_blank"
          href="https://cortex.so/"
        >
          https://cortex.so/
        </a>
      </p>
      <div className="mt-4">
        <div className="flex items-center gap-x-1">
          <AlertTriangleIcon
            size={16}
            className="text-[hsla(var(--warning-bg))]"
          />
          <p className="font-medium">What to expect:</p>
        </div>

        <div className="mt-2">
          <ul className="list-disc rounded-lg bg-[hsla(var(--warning-bg-soft))] p-4 pl-8">
            <li>Quick migration (few seconds)</li>
            <li>App will reload after the migration</li>
            <li>
              Some threads or models <span className="font-bold">might be</span>{' '}
              missing after the migration.
            </li>
          </ul>
        </div>
      </div>
      <div className="flex justify-end">
        <Button className="ml-2 mt-4" onClick={onMigrateNowClick}>
          Migrate Now
        </Button>
      </div>
    </Fragment>
  )
}

export default MigrationIntroContainer
