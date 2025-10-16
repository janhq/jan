import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState, useCallback } from 'react'
import HeaderPage from '@/containers/HeaderPage'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { IconDownload, IconClock } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { useServiceHub } from '@/hooks/useServiceHub'
import { MCPServerConfig, useMCPServers } from '@/hooks/useMCPServers'
import { toast } from 'sonner'
import { IconArrowLeft } from '@tabler/icons-react'
import { route } from '@/constants/routes'
import { Input } from '@/components/ui/input'
export const Route = createFileRoute('/settings/mcp-servers/hub')({
  component: RouteComponent,
})

type MCPItem = {
  id: string
  createdAt: string
  name: string
  githubUrl?: string
  description?: string
  logo?: string
  stars?: number
  commit?: string
  recommended?: boolean
  hidden?: boolean
  downloads?: number
  bannerUrl?: string
  mcpLanguage?: number
  bundlerCompatible?: boolean
  connections?: any[]
  github_url?: string
  categories?: string[]
  isVerified?: boolean
  mcp_language?: number
  bundler_compatible?: boolean
}

function RouteComponent() {
    const [items, setItems] = useState<MCPItem[]>([])
    const [page, setPage] = useState(1)
    const [isLoading, setIsLoading] = useState(false)
    const [hasMore, setHasMore] = useState(true)
    const [query, setQuery] = useState('')
    const [debouncedQuery, setDebouncedQuery] = useState(query)
    const containerRef = useRef<HTMLDivElement | null>(null)
    const navigate = Route.useNavigate()    
  const serviceHub = useServiceHub()
  const { addServer, editServer, getServerConfig, syncServers, deleteServer } = useMCPServers()
  const [installing, setInstalling] = useState<Record<string, boolean>>({})

    const LIMIT = 52
    const API_BASE = 'https://api.mcpservers.com/api/v1/mcp/registry'

    // Format dates similar to $modelId.tsx
    const formatDate = (dateString: string) => {
      try {
        const date = new Date(dateString)
        const now = new Date()
        const diffTime = Math.abs(now.getTime() - date.getTime())
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

        if (diffDays < 7) {
          return `${diffDays} days ago`
        } else if (diffDays < 30) {
          const weeks = Math.floor(diffDays / 7)
          return `${weeks} week${weeks > 1 ? 's' : ''} ago`
        } else if (diffDays < 365) {
          const months = Math.floor(diffDays / 30)
          return `${months} month${months > 1 ? 's' : ''} ago`
        } else {
          const years = Math.floor(diffDays / 365)
          return `${years} year${years > 1 ? 's' : ''} ago`
        }
      } catch (err) {
        return dateString
      }
    }
    function fixMalformedJson(input: string): string {
        let fixed = input.trim();
        fixed = fixed.replace(/(\w+)\s*:/g, '"$1":');
        fixed = fixed.replace(/:\s*config\.([A-Za-z0-9_]+)/g, ': "config.$1"');
        fixed = fixed.replace(/(\[\s*)([A-Za-z0-9@\/._-]+)(\s*\])/g, '$1"$2"$3');
        try {
            JSON.parse(fixed);
        } catch (err) {
            throw new Error(`This JSON is invalid : ${err}`);
        }
        return fixed;
    }          
        
    
    const fetchPage = useCallback(async (p: number, search?: string) => {
      setIsLoading(true)
      try {
  let url = `${API_BASE}?page=${p}&limit=${LIMIT}&recommended=true`
        // include search term in API query when present
        if (search && search.trim().length > 0) {
          // Assumption: API accepts `search` query parameter. If the API uses a different param name, update accordingly.
          url += `&search=${encodeURIComponent(search.trim())}`
        }
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        // Expecting { data: [...] }
        const data: MCPItem[] = Array.isArray(json.data) ? json.data : []
        if (data.length < LIMIT) setHasMore(false)
        setItems(prev => {
          // dedupe by id: only append items whose id isn't already present
          const existingIds = new Set(prev.map(i => i.id))
          const newItems = data.filter(i => !existingIds.has(i.id))
          return [...prev, ...newItems]
        })
      } catch (err) {
        // For now, stop further loads on error
        console.error('Failed to fetch MCP registry:', err)
        setHasMore(false)
      } finally {
        setIsLoading(false)
      }
    }, [])

    useEffect(() => {
      // initial load
      fetchPage(1)
    }, [fetchPage])

    useEffect(() => {
      if (!containerRef.current) return

      const el = containerRef.current
      const onScroll = () => {
        if (isLoading || !hasMore) return
        const threshold = 300 // px from bottom to trigger
        if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
          setPage(p => p + 1)
        }
      }

      el.addEventListener('scroll', onScroll)
      return () => el.removeEventListener('scroll', onScroll)
    }, [isLoading, hasMore])

    useEffect(() => {
      if (page === 1) return
      // fetch current page with current debounced query
      fetchPage(page, debouncedQuery)
    }, [page, fetchPage, debouncedQuery])

    // debounce the user's input so we don't spam the API on every keystroke
    useEffect(() => {
      const t = setTimeout(() => setDebouncedQuery(query), 200)
      return () => clearTimeout(t)
    }, [query])

    // when debouncedQuery changes, reset pagination and reload page 1
    useEffect(() => {
      setItems([])
      setPage(1)
      setHasMore(true)
      fetchPage(1, debouncedQuery)
    }, [debouncedQuery, fetchPage])

    const filtered = items.filter(item => {
      if (!query) return true
      const q = query.toLowerCase()
      return (
        (item.name && item.name.toLowerCase().includes(q)) ||
        (item.description && item.description.toLowerCase().includes(q)) ||
        (item.githubUrl && item.githubUrl.toLowerCase().includes(q)) ||
        (item.github_url && item.github_url.toLowerCase().includes(q))
      )
    })

  return (
    <div className="flex h-full w-full">
          <div className="flex flex-col h-full w-full ">
            <HeaderPage>
                <div className='flex flex-nowrap justify-between w-full'>

                    <button
                        className="relative z-20 flex items-center gap-2 cursor-pointer"
                        onClick={() => navigate({ to: route.settings.mcp_servers })}
                        aria-label="Go back"
                    >
                        <div className="flex items-center justify-center size-5 rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out">
                        <IconArrowLeft size={18} className="text-main-view-fg" />
                        </div>
                        <span className="text-main-view-fg">Back to MCP Servers</span>
                    </button>
                    <Input
                    aria-label="Search MCP"
                    placeholder="Search MCP servers..."
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    className='max-w-[20%] z-20'
                    />

                </div>
              
            </HeaderPage>
    
            
            

            <div
                ref={containerRef}
                style={{overflowY: 'auto', flex: 1, padding: 8}}
                data-testid="mcp-list-container"
            >
                {filtered.length === 0 && !isLoading ? (
                <div className='text-center text-muted-foreground mt-4'>No results found</div>
                ) : (
                <ul style={{listStyle: 'none', padding: 0, margin: 0}}>
                    {filtered.map(item => (
                      <li key={item.id} className="mb-6 p-6 rounded bg-card">
                        <div className="max-w-4xl mx-auto">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="w-14 h-14 flex-shrink-0">
                                {item.logo ? (
                                  // eslint-disable-next-line jsx-a11y/img-redundant-alt
                                  <img src={item.logo} alt={`${item.name} logo`} className="w-14 h-14 rounded object-cover" />
                                ) : (
                                  <div className="w-14 h-14 rounded bg-muted-foreground/10" />
                                )}
                              </div>
                              <div>
                                <h3 className="text-2xl font-semibold text-main-view-fg break-words">{item.name}</h3>
                                <div className="flex items-center gap-4 text-sm text-main-view-fg/60 mt-2">
                                  <div className="flex items-center gap-2">
                                    <IconDownload size={16} />
                                    <span>{item.downloads ?? 0} Downloads</span>
                                  </div>
                                  {item.createdAt && (
                                    <div className="flex items-center gap-2">
                                      <IconClock size={16} />
                                      <span>Updated {formatDate(item.createdAt)}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-4">
                              <div className="text-sm text-muted-foreground">{item.stars ?? '-'} ★</div>
                              {item.recommended && <span className="px-2 py-1 text-xs bg-emerald-100 text-emerald-800 rounded">Recommended</span>}
                              {item.isVerified && <span className="px-2 py-1 text-xs bg-sky-100 text-sky-800 rounded">Verified</span>}
                            </div>
                          </div>

                          {item.description && (
                            <div className="text-main-view-fg/80 mt-4">
                              <RenderMarkdown
                                enableRawHtml={true}
                                className="select-none reset-heading"
                                components={{
                                  a: ({ ...props }) => (
                                    <a {...props} target="_blank" rel="noopener noreferrer" />
                                  ),
                                }}
                                content={item.description}
                              />
                            </div>
                          )}

                          {item.categories && item.categories.length > 0 && (
                            <div className="flex gap-2 flex-wrap mt-4">
                              {item.categories.map((c) => (
                                <span key={c} className="px-3 py-1 text-sm bg-main-view-fg/10 text-main-view-fg rounded-md">{c}</span>
                              ))}
                            </div>
                          )}

                          <div className="mt-6 flex items-center justify-end gap-3">
                            {(item.githubUrl || item.github_url) && (
                              <a href={item.githubUrl || item.github_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">Repository</a>
                            )}
                            <Button size="sm" onClick={async () => {
                              const key = item.name
                              setInstalling(prev => ({...prev, [item.id]: true}))
                              // prevent duplicates
                              if (getServerConfig(key)) {
                                deleteServer(key);
                                
                              }
                              const parseMCPServerConfig = (item : MCPItem) => {
                                const connections = item.connections && Array.isArray(item.connections) ? item.connections : [];
                                const mcp : Array<MCPServerConfig> = []
                                for (const conn of connections) {
                                    let stdioFunction = conn.stdioFunction;
                                    stdioFunction = stdioFunction.match(/=>\s*((.*?))(?=\s*$|\s*=>)/)[1];
                                    
                                    stdioFunction = stdioFunction.trim()
                                    if (stdioFunction.startsWith('(')) stdioFunction = stdioFunction.slice(1)
                                    if (stdioFunction.endsWith(')')) stdioFunction = stdioFunction.slice(0, -1)
                                    
                                    const config : MCPServerConfig = JSON.parse(fixMalformedJson(stdioFunction)) as MCPServerConfig;
                                    if (!config && !config.command) continue;
                                    mcp.push(config);
                        

                                }
                                return mcp
                              }

                              const config = parseMCPServerConfig(item)
                              if (config.length === 0) {
                                toast.error('No valid MCP server configuration found for this item.')
                                setInstalling(prev => ({...prev, [item.id]: false}))
                                return;
                             }   

                              for (const cfg of config) {
                                addServer(key, cfg);
                              }
                                syncServers().then(() => {
                                    toast.success('Server installed successfully')
                                    setInstalling(prev => ({...prev, [item.id]: false}))
                                }).catch(err => {
                                    console.error('Failed to sync servers after adding:', err)
                                    toast.error('Failed to sync server. Please try again.')
                                    setInstalling(prev => ({...prev, [item.id]: false}))
                                })
                            }}>{installing[item.id] ? 'Installing...' : getServerConfig(item.name) ? 'Reinstall' : 'Install'}</Button>
                          </div>
                        </div>
                      </li>
                    ))}
                </ul>
                )}

                <div style={{padding: 12, textAlign: 'center'}}>
                </div>
            </div>
          </div>
        </div>
    
  )
}
