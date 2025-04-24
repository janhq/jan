import React, { useState, useEffect, useCallback } from 'react'

import { Button, Input } from '@janhq/joi'
import { useAtom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { PlusIcon } from 'lucide-react'
import { npxFinder, NPMPackage } from 'npx-scope-finder'

import { toaster } from '@/containers/Toast'

interface MCPConfig {
  mcpServers: {
    [key: string]: {
      command: string
      args: string[]
      env: Record<string, string>
    }
  }
}

const mcpPackagesAtom = atomWithStorage<NPMPackage[]>('mcpPackages', [])
const MCPSearch = () => {
  const [showToast, setShowToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const [orgName, setOrgName] = useState('@modelcontextprotocol')
  const [packages, setPackages] = useAtom(mcpPackagesAtom)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const searchOrganizationPackages = useCallback(async () => {
    if (!orgName) return

    try {
      setLoading(true)
      setError('')

      // Remove @ symbol if present at the beginning
      // const scopeName = orgName.startsWith('@') ? orgName.substring(1) : orgName

      // Use npxFinder to search for packages from the specified organization
      const result = await npxFinder(orgName)

      setPackages(result || [])
    } catch (err) {
      console.error('Error searching for packages:', err)
      setError('Failed to search for packages. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [orgName])

  // Search for packages when the component mounts
  useEffect(() => {
    searchOrganizationPackages()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <h2 className="mt-2 text-lg font-bold">NPX Package List</h2>
      <p className="text-[hsla(var(--text-secondary))]">
        Search and add npm packages as MCP servers
      </p>

      <div className="mt-6">
        <div className="flex gap-2">
          <input
            id="orgName"
            type="text"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && orgName) {
                e.preventDefault()
                searchOrganizationPackages()
              }
            }}
            className="input w-full"
            placeholder="Enter npm scope name (e.g. @janhq)"
          />
          <Button
            onClick={searchOrganizationPackages}
            disabled={loading || !orgName}
          >
            {loading ? 'Searching...' : 'Search'}
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      </div>

      {packages.length > 0 ? (
        <div className="mt-6">
          {packages.map((pkg, index) => (
            <div
              key={index}
              className="my-2 rounded-xl border border-[hsla(var(--app-border))]"
            >
              <div className="flex justify-between border-b border-[hsla(var(--app-border))] px-4 py-3">
                <span>{pkg.name?.split('/')[1]}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-[hsla(var(--text-secondary))]">
                    {pkg.version}
                  </span>
                  <Button theme="icon" onClick={() => handleAddToConfig(pkg)}>
                    <PlusIcon />
                  </Button>
                </div>
              </div>
              <div className="px-4 py-3">
                <p>{pkg.description || 'No description'}</p>
                <p className="my-2 whitespace-nowrap text-[hsla(var(--text-secondary))]">
                  Usage: npx {pkg.name}
                </p>
                <a
                  target="_blank"
                  href={`https://www.npmjs.com/package/${pkg.name}`}
                >{`https://www.npmjs.com/package/${pkg.name}`}</a>
              </div>
            </div>
          ))}
        </div>
      ) : (
        !loading && (
          <div className="mt-4">
            <p>
              No packages found. Try searching for a different organization.
            </p>
          </div>
        )
      )}

      {showToast && (
        <div
          className={`fixed bottom-4 right-4 z-50 rounded-md p-4 shadow-lg ${
            toastType === 'success'
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <span>{toastMessage}</span>
            <button
              onClick={() => setShowToast(false)}
              className="ml-4 text-gray-500 hover:text-gray-700"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </>
  )

  // Function to add a package to the MCP configuration
  async function handleAddToConfig(pkg: NPMPackage) {
    try {
      // Get current configuration
      const currentConfig = await window.core?.api.getMcpConfigs()

      // Parse the configuration
      let config: MCPConfig
      try {
        config = JSON.parse(currentConfig || '{"mcpServers": {}}')
      } catch (err) {
        // If parsing fails, start with an empty configuration
        config = { mcpServers: {} }
      }

      // Generate a unique server name based on the package name
      const serverName = pkg.name?.split('/')[1] || 'unknown'

      // Check if this server already exists
      if (config.mcpServers[serverName]) {
        toaster({
          title: `Add ${serverName}`,
          description: `Server ${serverName} already exists in configuration`,
          type: 'error',
        })
        return
      }

      // Add the new server configuration
      config.mcpServers[serverName] = {
        command: 'npx',
        args: ['-y', pkg.name || ''],
        env: {},
      }

      // Save the updated configuration
      await window.core?.api?.saveMcpConfigs({
        configs: JSON.stringify(config, null, 2),
      })
      await window.core?.api?.restartMcpServers()

      toaster({
        title: `Add ${serverName}`,
        description: `Added ${serverName} to MCP configuration`,
        type: 'success',
      })
    } catch (err) {
      toaster({
        title: `Add ${pkg.name?.split('/')[1] || 'unknown'} failed`,
        description: `Failed to add package to configuration`,
        type: 'error',
      })
      console.error('Error adding package to configuration:', err)
    }
  }
}

export default MCPSearch
