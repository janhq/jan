import { useState } from 'react'

import { Input } from '@janhq/uikit'

import { useAtomValue } from 'jotai'
import { SearchIcon } from 'lucide-react'

import RowModel from './Row'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

const Column = ['Name', 'Model ID', 'Size', 'Version', 'Status', '']

export default function Models() {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const [searchValue, setsearchValue] = useState('')

  const filteredDownloadedModels = downloadedModels.filter((x) => {
    return x.name?.toLowerCase().includes(searchValue.toLowerCase())
  })

  return (
    <div className="rounded-xl border border-border shadow-sm">
      <div className="px-6 py-5">
        <div className="relative w-1/3">
          <SearchIcon
            size={20}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search"
            className="pl-8"
            onChange={(e) => {
              setsearchValue(e.target.value)
            }}
          />
        </div>
      </div>
      <div className="relative">
        <table className="w-full px-8">
          <thead className="w-full border-b border-border bg-secondary">
            <tr>
              {Column.map((col, i) => {
                return (
                  <th
                    key={i}
                    className="px-6 py-2 text-left font-normal last:text-center"
                  >
                    {col}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {filteredDownloadedModels
              ? filteredDownloadedModels.map((x, i) => {
                  return <RowModel key={i} data={x} />
                })
              : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
