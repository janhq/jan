import React from 'react'
import ModelTableHeader from '../ModelTableHeader'
import { DownloadState } from '@/_models/DownloadState'
import ModelDownloadingRow from '../ModelDownloadingRow'

type Props = {
  downloadStates: DownloadState[]
}

const tableHeaders = ['MODEL', 'TRANSFERRED', 'SIZE', 'PERCENTAGE', 'SPEED']

const ModelDownloadingTable: React.FC<Props> = ({ downloadStates }) => (
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
        {downloadStates.map((state) => (
          <ModelDownloadingRow key={state.fileName} downloadState={state} />
        ))}
      </tbody>
    </table>
  </div>
)

export default React.memo(ModelDownloadingTable)
