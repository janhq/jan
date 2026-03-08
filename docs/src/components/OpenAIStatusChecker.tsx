import React, { useState, useEffect, useCallback } from 'react'
import { AlertCircle, CheckCircle, Clock, RefreshCw } from 'lucide-react'

interface StatusData {
  status:
    | 'operational'
    | 'degraded'
    | 'partial_outage'
    | 'major_outage'
    | 'under_maintenance'
    | 'unknown'
  lastUpdated: string
  incidents: Array<{
    name: string
    status: string
    impact: string
  }>
}

const StatusIcon = ({ status }: { status: string }) => {
  switch (status) {
    case 'operational':
      return <CheckCircle className="w-5 h-5 text-green-500" />
    case 'degraded':
    case 'partial_outage':
      return <AlertCircle className="w-5 h-5 text-yellow-500" />
    case 'major_outage':
      return <AlertCircle className="w-5 h-5 text-red-500" />
    case 'under_maintenance':
      return <Clock className="w-5 h-5 text-blue-500" />
    default:
      return <AlertCircle className="w-5 h-5 text-gray-500" />
  }
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'operational':
      return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800'
    case 'degraded':
    case 'partial_outage':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-300 dark:border-yellow-800'
    case 'major_outage':
      return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800'
    case 'under_maintenance':
      return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800'
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/20 dark:text-gray-300 dark:border-gray-800'
  }
}

const getStatusText = (status: string) => {
  switch (status) {
    case 'operational':
      return 'All Systems Operational'
    case 'degraded':
      return 'Degraded Performance'
    case 'partial_outage':
      return 'Partial Service Outage'
    case 'major_outage':
      return 'Major Service Outage'
    case 'under_maintenance':
      return 'Under Maintenance'
    default:
      return 'Status Unknown'
  }
}

export const OpenAIStatusChecker: React.FC = () => {
  const [statusData, setStatusData] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const fetchStatus = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      console.log('Fetching real OpenAI status...')

      // Use CORS proxy to fetch real OpenAI status
      const proxyUrl = 'https://api.allorigins.win/get?url='
      const targetUrl = 'https://status.openai.com/api/v2/status.json'

      const response = await fetch(proxyUrl + encodeURIComponent(targetUrl))

      if (!response.ok) {
        throw new Error(`Proxy returned ${response.status}`)
      }

      const proxyData = await response.json()
      const openaiData = JSON.parse(proxyData.contents)

      console.log('Real OpenAI data received:', openaiData)

      // Transform real OpenAI data to our format
      const transformedData: StatusData = {
        status: mapOpenAIStatusClient(
          openaiData.status?.indicator || 'operational'
        ),
        lastUpdated: openaiData.page?.updated_at || new Date().toISOString(),
        incidents: (openaiData.incidents || []).slice(0, 3),
      }

      setStatusData(transformedData)
      setLastRefresh(new Date())
      console.log('✅ Real OpenAI status loaded successfully!')
    } catch (err) {
      console.error('Failed to fetch real status:', err)

      // Fallback: try alternative proxy
      try {
        console.log('Trying alternative proxy...')
        const altResponse = await fetch(
          `https://cors-anywhere.herokuapp.com/https://status.openai.com/api/v2/summary.json`
        )

        if (altResponse.ok) {
          const altData = await altResponse.json()
          setStatusData({
            status: mapOpenAIStatusClient(
              altData.status?.indicator || 'operational'
            ),
            lastUpdated: new Date().toISOString(),
            incidents: [],
          })
          setLastRefresh(new Date())
          console.log('✅ Alternative proxy worked!')
          return
        }
      } catch (altErr) {
        console.log('Alternative proxy also failed')
      }

      // Final fallback
      setError('Unable to fetch real-time status')
      setStatusData({
        status: 'operational' as const,
        lastUpdated: new Date().toISOString(),
        incidents: [],
      })
      setLastRefresh(new Date())
      console.log('Using fallback status')
    } finally {
      setLoading(false)
    }
  }, [])

  // Client-side status mapping function
  const mapOpenAIStatusClient = (indicator: string): StatusData['status'] => {
    switch (indicator.toLowerCase()) {
      case 'none':
      case 'operational':
        return 'operational'
      case 'minor':
        return 'degraded'
      case 'major':
        return 'partial_outage'
      case 'critical':
        return 'major_outage'
      case 'maintenance':
        return 'under_maintenance'
      default:
        return 'operational' as const // Default to operational
    }
  }

  useEffect(() => {
    fetchStatus()
    // Refresh every 2 minutes for more real-time updates
    const interval = setInterval(fetchStatus, 2 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const handleRefresh = () => {
    fetchStatus()
  }

  if (loading && !statusData) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-center space-x-3">
          <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
          <span className="text-lg font-medium text-gray-700 dark:text-gray-300">
            Checking OpenAI Status...
          </span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-red-200 dark:border-red-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <AlertCircle className="w-6 h-6 text-red-500" />
            <div>
              <h3 className="text-lg font-semibold text-red-800 dark:text-red-300">
                Unable to Check Status
              </h3>
              <p className="text-red-600 dark:text-red-400">{error}</p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 bg-red-100 hover:bg-red-200 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300 rounded-lg font-medium transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700 my-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <StatusIcon status={statusData?.status || 'unknown'} />
          <div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              OpenAI Services
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Last updated: {new Date(lastRefresh).toLocaleTimeString()}
            </p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={`w-5 h-5 text-gray-600 dark:text-gray-400 ${loading ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      <div
        className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold border ${getStatusColor(statusData?.status || 'unknown')}`}
      >
        {getStatusText(statusData?.status || 'unknown')}
      </div>

      <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
        <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Quick Status Check
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-600 dark:text-gray-400">ChatGPT</span>
            <StatusIcon status={statusData?.status || 'unknown'} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600 dark:text-gray-400">API</span>
            <StatusIcon status={statusData?.status || 'unknown'} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600 dark:text-gray-400">Playground</span>
            <StatusIcon status={statusData?.status || 'unknown'} />
          </div>
        </div>
      </div>

      <div className="mt-4 text-xs text-gray-500 dark:text-gray-400 text-center">
        {error
          ? 'Using fallback status • '
          : '🟢 Real-time data from OpenAI • '}
        Updated: {new Date(lastRefresh).toLocaleTimeString()}
        <br />
        <a
          href="/post/is-chatgpt-down-use-jan#-is-chatgpt-down"
          className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline"
        >
          View detailed status guide
        </a>
      </div>
    </div>
  )
}
