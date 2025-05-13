import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useModelSources } from '@/hooks/useModelSources'
import { useEffect, useMemo, useState } from 'react'
import { ModelSource } from '@janhq/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search, ArrowLeft } from 'lucide-react'
import { extractDescription, extractModelName } from '@/lib/models'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { fuzzySearch } from '@/lib/utils'
import { Card } from '@/containers/Card'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.hub as any)({
  component: Hub,
})

const sortOptions = [
  { value: 'newest', name: 'Newest' },
  { value: 'most-downloaded', name: 'Most downloaded' },
]

function Hub() {
  const { sources, fetchSources, loading } = useModelSources()
  const [searchValue, setSearchValue] = useState('')
  const [sortSelected, setSortSelected] = useState('newest')
  const [selectedModel, setSelectedModel] = useState<ModelSource | undefined>(
    undefined
  )

  // Search functionality
  const searchedModels = useMemo(
    () =>
      searchValue.length
        ? (sources?.filter((e) =>
            fuzzySearch(
              searchValue.replace(/\s+/g, '').toLowerCase(),
              e.id.toLowerCase()
            )
          ) ?? [])
        : [],
    [sources, searchValue]
  )

  // Sorting functionality
  const sortedModels = useMemo(() => {
    return [...sources].sort((a, b) => {
      if (sortSelected === 'most-downloaded') {
        return (b.metadata?.downloads || 0) - (a.metadata?.downloads || 0)
      } else {
        return (
          new Date(b.metadata?.createdAt || 0).getTime() -
          new Date(a.metadata?.createdAt || 0).getTime()
        )
      }
    })
  }, [sortSelected, sources])

  // Filtered models
  const filteredModels = useMemo(() => {
    // Apply additional filters here if needed
    return sortedModels
  }, [sortedModels])

  useEffect(() => {
    fetchSources()
  }, [fetchSources])

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value)
  }

  // Handle model selection
  const handleModelSelect = (model: ModelSource) => {
    setSelectedModel(model)
  }

  // Go back from model detail view
  const handleGoBack = () => {
    setSelectedModel(undefined)
  }

  // if (selectedModel) {
  //   return (
  //     <div className="flex h-full flex-col p-4">
  //       <div className="mb-4 flex items-center">
  //         <Button variant="link" onClick={handleGoBack} className="mr-2">
  //           <ArrowLeft size={16} />
  //         </Button>
  //         <h2 className="text-xl font-semibold">
  //           {extractModelRepo(selectedModel.id)}
  //         </h2>
  //       </div>
  //       <div className="flex-1 overflow-auto">
  //         <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
  //           <div className="rounded-lg border p-4">
  //             <h3 className="mb-2 text-lg font-medium">Model Information</h3>
  //             <div className="space-y-2">
  //               <div>
  //                 <span className="font-medium">ID:</span> {selectedModel.id}
  //               </div>
  //               <div>
  //                 <span className="font-medium">Downloads:</span>{' '}
  //                 {selectedModel.metadata?.downloads || 0}
  //               </div>
  //               <div>
  //                 <span className="font-medium">Created:</span>{' '}
  //                 {new Date(
  //                   selectedModel.metadata?.createdAt || 0
  //                 ).toLocaleDateString()}
  //               </div>
  //               {selectedModel.metadata?.description && (
  //                 <div>
  //                   <span className="font-medium">Description:</span>{' '}
  //                   {selectedModel.metadata.description}
  //                 </div>
  //               )}
  //             </div>
  //           </div>
  //           <div className="rounded-lg border p-4">
  //             <h3 className="mb-2 text-lg font-medium">Available Variants</h3>
  //             <div className="space-y-2">
  //               {selectedModel.models?.map((model, index) => (
  //                 <div key={index} className="rounded-md border p-2">
  //                   <div>
  //                     <span className="font-medium">Name:</span>{' '}
  //                     {model.id || 'Unknown'}
  //                   </div>
  //                   <div>
  //                     <span className="font-medium">Size:</span>{' '}
  //                     {(model.size / (1024 * 1024 * 1024)).toFixed(2)} GB
  //                   </div>
  //                   <div className="mt-2">
  //                     <Button size="sm">Download</Button>
  //                   </div>
  //                 </div>
  //               ))}
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //     </div>
  //   )
  // }

  return (
    <div className="flex h-full flex-col">
      {/* <div className="px-4 py-6">
        <h1 className="text-3xl font-editorialnew">Model Hub</h1>
      </div> */}

      {/* <div className="mb-4 flex flex-col space-y-4 sm:flex-row sm:items-center sm:space-x-4 sm:space-y-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search models..."
            value={searchValue}
            onChange={handleSearchChange}
            className="pl-10"
          />
          {searchValue.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg">
              {searchedModels.length === 0 ? (
                <div className="p-2 text-center text-muted-foreground">
                  No results found
                </div>
              ) : (
                <div className="max-h-60 overflow-auto">
                  {searchedModels.map((model) => (
                    <div
                      key={model.id}
                      className="cursor-pointer px-4 py-2 hover:bg-muted"
                      onClick={() => handleModelSelect(model)}
                    >
                      {extractModelRepo(model.id)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex-shrink-0">
          <select
            value={sortSelected}
            onChange={(e) => setSortSelected(e.target.value)}
            className="rounded-md border px-3 py-2"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      </div> */}

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="text-center text-muted-foreground">
              Loading models...
            </div>
          </div>
        ) : filteredModels.length === 0 ? (
          <div className="flex h-40 items-center justify-center">
            <div className="text-center text-muted-foreground">
              No models found
            </div>
          </div>
        ) : (
          <div className="p-4">
            {filteredModels.map((model) => (
              <div
                key={model.id}
                className="my-2"
                // onClick={() => handleModelSelect(model)}
              >
                <Card title={extractModelName(model.id) || ''}>
                  <p>
                    Lorem ipsum, dolor sit amet consectetur adipisicing elit.
                    Nam, labore? Veniam beatae fugit quasi quia ab dolor, iure
                    magni autem! Consectetur ad perspiciatis incidunt aliquid
                    amet, assumenda sapiente inventore ipsam?
                  </p>
                </Card>
                {/* <h3 className="mb-2 font-medium capitalize">
                  {extractModelName(model.id) || ''}
                  <div className="line-clamp-2">
                    <RenderMarkdown
                      components={{
                        a: ({ ...props }) => (
                          <a
                            {...props}
                            target="_blank"
                            rel="noopener noreferrer"
                          />
                        ),
                      }}
                      content={
                        extractDescription(model.metadata.description) || ''
                      }
                    />
                  </div>
                </h3> */}
                {/* <div className="text-sm text-muted-foreground">
                  <div>Downloads: {model.metadata?.downloads || 0}</div>
                  <div>Variants: {model.models?.length || 0}</div>
                </div> */}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
