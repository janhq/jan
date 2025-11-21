import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { useCallback, useEffect, useState } from 'react'
import { RouterManager } from '@janhq/core'
import { useAppState } from '@/hooks/useAppState'
import { Switch } from '@/components/ui/switch'
import { Card, CardItem } from '@/containers/Card'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.router as any)({
  component: RouterSettings,
})

function RouterSettings() {
  const [strategies, setStrategies] = useState<
    Array<{ name: string; description: string }>
  >([])
  const [currentStrategy, setCurrentStrategy] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [allowedModels, setAllowedModels] = useState<string>('')
  const routingEnabled = useAppState((state) => state.routingEnabled)
  const setRoutingEnabled = useAppState((state) => state.setRoutingEnabled)

  useEffect(() => {
    loadRouterSettings()
  }, [])

  const loadRouterSettings = useCallback(async () => {
    try {
      console.log('[Router Settings] Attempting to load router...')
      const routerManager = RouterManager.instance()
      console.log('[Router Settings] RouterManager instance:', routerManager)
      
      const router = routerManager.get()
      console.log('[Router Settings] Router from manager:', router)
      
      if (router) {
        const availableStrategies = router.listStrategies()
        setStrategies(availableStrategies)
        
        const activeStrategy = router.getStrategy()
        setCurrentStrategy(activeStrategy.name)

        // Load allowed models setting
        if (router.getSettings) {
          const settings = await router.getSettings()
          const allowedModelsSetting = settings.find(s => s.key === 'allowed_models')
          if (allowedModelsSetting) {
            setAllowedModels(allowedModelsSetting.controllerProps.value as string)
          }
        }

        console.log('[Router Settings] Loaded successfully:', {
          strategies: availableStrategies,
          currentStrategy: activeStrategy.name
        })
      } else {
        console.warn('[Router Settings] Router extension not yet loaded, retrying in 1000ms...')
        // Retry after a longer delay to allow extension loading
        setTimeout(() => {
          console.log('[Router Settings] Retry attempt...')
          if (!loading) {
            console.log('[Router Settings] Already loaded, skipping retry')
            return
          }
          const retryRouter = RouterManager.instance().get()
          console.log('[Router Settings] Retry - Router from manager:', retryRouter)
          
          if (retryRouter) {
            const availableStrategies = retryRouter.listStrategies()
            setStrategies(availableStrategies)
            
            const activeStrategy = retryRouter.getStrategy()
            setCurrentStrategy(activeStrategy.name)

            // Load allowed models setting on retry
            if (retryRouter.getSettings) {
              retryRouter.getSettings().then(settings => {
                const allowedModelsSetting = settings.find(s => s.key === 'allowed_models')
                if (allowedModelsSetting) {
                  setAllowedModels(allowedModelsSetting.controllerProps.value as string)
                }
              })
            }

            console.log('[Router Settings] Loaded successfully on retry:', {
              strategies: availableStrategies,
              currentStrategy: activeStrategy.name
            })
          } else {
            console.error('[Router Settings] Router still not available after retry')
          }
          setLoading(false)
        }, 1000)
        return // Don't set loading to false yet
      }
    } catch (error) {
      console.error('[Router Settings] Failed to load router settings:', error)
    } finally {
      setLoading(false)
    }
  }, [loading])

  const handleStrategyChange = useCallback(
    async (strategyName: string) => {
      try {
        const router = RouterManager.instance().get()
        if (router) {
          const success = router.setStrategyByName(strategyName)
          if (success) {
            setCurrentStrategy(strategyName)
            console.log(`[Router Settings] Switched to strategy: ${strategyName}`)
          }
        }
      } catch (error) {
        console.error('Failed to change strategy:', error)
      }
    },
    []
  )

  const handleToggleRouting = useCallback(() => {
    setRoutingEnabled(!routingEnabled)
  }, [routingEnabled, setRoutingEnabled])

  const handleAllowedModelsChange = useCallback(
    async (value: string) => {
      setAllowedModels(value)
      try {
        const router = RouterManager.instance().get()
        if (router && router.updateSettings) {
          await router.updateSettings([
            { key: 'allowed_models', controllerProps: { value } }
          ])
          console.log('[Router Settings] Updated allowed models:', value)
        }
      } catch (error) {
        console.error('Failed to update allowed models:', error)
      }
    },
    []
  )

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <HeaderPage>
          <h1 className="font-medium">Settings</h1>
        </HeaderPage>
        <div className="flex h-full w-full flex-col sm:flex-row">
          <SettingsMenu />
          <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
            <div className="flex items-center justify-center py-8">
              <div className="text-main-view-fg/60">Loading router settings...</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (strategies.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <HeaderPage>
          <h1 className="font-medium">Settings</h1>
        </HeaderPage>
        <div className="flex h-full w-full flex-col sm:flex-row">
          <SettingsMenu />
          <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
            <div className="flex flex-col items-center justify-center py-8 space-y-2">
              <div className="text-main-view-fg/60">Router extension not loaded</div>
              <div className="text-xs text-main-view-fg/40">
                The router extension may not be installed or enabled
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full pb-[calc(env(safe-area-inset-bottom)+env(safe-area-inset-top))]">
      <HeaderPage>
        <h1 className="font-medium">Settings</h1>
      </HeaderPage>
      <div className="flex h-full w-full flex-col sm:flex-row">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* Enable/Disable Auto Routing */}
            <Card title="Auto Routing">
              <CardItem
                title="Enable Auto Routing"
                description="Automatically select the best model for each query based on content analysis"
                className="flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-y-2"
                actions={
                  <Switch
                    checked={routingEnabled}
                    onCheckedChange={handleToggleRouting}
                  />
                }
              />
            </Card>

            {/* Strategy Selection */}
            <Card title="Routing Strategy">
              <div className="p-4 flex flex-col space-y-3">
                <p className="text-xs text-main-view-fg/60">
                  Choose how the router analyzes queries and selects models
                </p>

                <div className="space-y-2">
                  {strategies.map((strategy) => (
                    <div
                      key={strategy.name}
                      onClick={() => handleStrategyChange(strategy.name)}
                      className={`
                        flex items-start p-4 rounded-lg border cursor-pointer transition-all
                        ${
                          currentStrategy === strategy.name
                            ? 'border-primary bg-primary/5'
                            : 'border-main-view-fg/10 hover:border-main-view-fg/20 hover:bg-main-view-fg/5'
                        }
                      `}
                    >
                      <div className="flex items-start flex-1 min-w-0">
                        <div className="flex-shrink-0 mt-0.5">
                          <div
                            className={`
                              w-4 h-4 rounded-full border-2 flex items-center justify-center
                              ${
                                currentStrategy === strategy.name
                                  ? 'border-primary'
                                  : 'border-main-view-fg/30'
                              }
                            `}
                          >
                            {currentStrategy === strategy.name && (
                              <div className="w-2 h-2 rounded-full bg-primary"></div>
                            )}
                          </div>
                        </div>
                        <div className="ml-3 flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-main-view-fg capitalize">
                              {strategy.name.replace('-', ' ')}
                            </span>
                            {currentStrategy === strategy.name && (
                              <span className="text-xs text-primary font-medium">
                                Active
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-main-view-fg/60 mt-1">
                            {strategy.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {/* Allowed Models Configuration */}
            <Card title="Allowed Models">
              <CardItem
                title="Model Whitelist"
                description="Comma-separated list of model IDs that the router is allowed to select. Leave empty to allow all models."
                className="flex-col sm:flex-row items-start gap-y-2"
              />
              <div className="px-4 pb-4">
                <input
                  type="text"
                  value={allowedModels}
                  onChange={(e) => handleAllowedModelsChange(e.target.value)}
                  placeholder="e.g., Qwen3-VL-8B-Instruct-IQ4_XS,gemma-3n-E4B-it-IQ4_XS"
                  className="w-full px-3 py-2 text-sm border border-main-view-fg/10 rounded-lg bg-transparent text-main-view-fg focus:outline-none focus:border-primary"
                />
                <p className="text-xs text-main-view-fg/60 mt-2">
                  Example: <code className="px-1 py-0.5 bg-main-view-fg/5 rounded">Qwen3-VL-8B-Instruct-IQ4_XS,gemma-3n-E4B-it-IQ4_XS</code>
                </p>
              </div>
            </Card>

            {/* Info Section */}
            <Card title="How Auto Routing Works">
              <div className="p-4">
                <ul className="text-xs text-main-view-fg/60 space-y-1.5 list-disc list-inside">
                  <li>
                    When enabled, the router automatically selects the best model for
                    each message
                  </li>
                  <li>
                    Code queries are routed to models with code generation
                    capabilities
                  </li>
                  <li>
                    Complex reasoning tasks are sent to larger, more capable models
                  </li>
                  <li>
                    Simple queries use faster, smaller models for quick responses
                  </li>
                  <li>
                    You can override automatic routing by manually selecting a model
                  </li>
                </ul>
              </div>
            </Card>

            {/* Strategy Descriptions */}
            <Card title="Strategy Details">
              <div className="p-4 space-y-3">
                <div>
                  <h5 className="text-xs font-medium text-main-view-fg">
                    Heuristic Strategy
                  </h5>
                  <p className="text-xs text-main-view-fg/60 mt-1">
                    Fast rule-based routing using pattern matching and keyword
                    analysis. Routing decisions complete in &lt;10ms with no
                    additional API calls.
                  </p>
                </div>

                <div>
                  <h5 className="text-xs font-medium text-main-view-fg">
                    LLM-Based Strategy
                  </h5>
                  <p className="text-xs text-main-view-fg/60 mt-1">
                    Uses a small language model to analyze queries and make
                    intelligent routing decisions. More accurate but requires
                    loading an additional model. (Coming soon)
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
