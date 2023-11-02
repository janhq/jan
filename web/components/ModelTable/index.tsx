import React from 'react'

import ModelRow from '../ModelRow'
import ModelTableHeader from '../ModelTableHeader'
import { Model } from '@janhq/core/lib/types'

type Props = {
  models: Model[]
}

const tableHeaders = ['MODEL', 'FORMAT', 'SIZE', 'STATUS', 'ACTIONS']

const ModelTable: React.FC<Props> = ({ models }) => (
  <>
    <div className="border-border overflow-hidden rounded-lg border align-middle shadow-lg">
      <table className="min-w-full">
        <thead className="bg-background">
          <tr className="rounded-t-lg">
            {tableHeaders.map((item) => (
              <ModelTableHeader key={item} title={item} />
            ))}
          </tr>
        </thead>
        <tbody>
          {models?.map((model) => <ModelRow key={model._id} model={model} />)}
        </tbody>
      </table>
    </div>
    <div className="relative"></div>
  </>
)

export default React.memo(ModelTable)
