import React from 'react'
import ModelRow from '../ModelRow'
import ModelTableHeader from '../ModelTableHeader'
import { AssistantModel } from '@/_models/AssistantModel'

type Props = {
  models: AssistantModel[]
}

const tableHeaders = ['MODEL', 'FORMAT', 'SIZE', 'STATUS', 'ACTIONS']

const ModelTable: React.FC<Props> = ({ models }) => (
  <div className="flow-root min-w-full rounded-lg border border-gray-200 align-middle shadow-lg">
    <table className="min-w-full">
      <thead className="border-b border-gray-200 bg-gray-50">
        <tr className="rounded-t-lg">
          {tableHeaders.map((item) => (
            <ModelTableHeader key={item} title={item} />
          ))}
          <th scope="col" className="relative w-fit px-6 py-3">
            <span className="sr-only">Edit</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {models.map((model) => (
          <ModelRow key={model._id} model={model} />
        ))}
      </tbody>
    </table>
  </div>
)

export default React.memo(ModelTable)
