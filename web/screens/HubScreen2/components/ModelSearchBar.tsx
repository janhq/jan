import React, { useCallback } from 'react'

import { Search } from 'lucide-react'

type Props = {
  queryText: string
  onSearchChanged: (query: string) => void
}

const ModelSearchBar: React.FC<Props> = ({ queryText, onSearchChanged }) => {
  const onQueryChanged = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const text = e.target.value
      onSearchChanged(text)
    },
    [onSearchChanged]
  )

  return (
    <div className="mx-4 mt-4 flex h-[128px] items-center justify-center gap-3 rounded-[10px] bg-blue-400">
      <div className="flex h-8 w-full max-w-[320px] items-center gap-2 rounded-md border bg-[hsla(var(--app-bg))] p-2">
        <Search size={16} />
        <input
          className="flex-1 outline-none"
          placeholder="Search"
          value={queryText}
          onChange={onQueryChanged}
        />
      </div>
      {/* <Button className="flex items-center gap-2"> */}
      {/*   <Upload size={16} /> */}
      {/*   <span className="hidden text-sm font-semibold md:block"> */}
      {/*     Import model */}
      {/*   </span> */}
      {/* </Button> */}
    </div>
  )
}

export default ModelSearchBar
