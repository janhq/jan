import React, { useState, useEffect, useCallback } from 'react'

import { fs, joinPath } from '@janhq/core'
import { Button } from '@janhq/joi'
import { useAtomValue } from 'jotai'

import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'

const MCP = () => {
  const janDataFolderPath = useAtomValue(janDataFolderPathAtom)
  const [configContent, setConfigContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  console.log(janDataFolderPath, 'janDataFolderPath')

  const readConfigFile = useCallback(async () => {
    try {
      const configPath = await joinPath([janDataFolderPath, 'mcp_config.json'])

      // Check if the file exists
      const fileExists = await fs.existsSync(configPath)

      if (fileExists) {
        // Read the file
        const content = await fs.readFileSync(configPath, 'utf-8')
        setConfigContent(content)
      } else {
        // Create a default config if it doesn't exist
        const defaultConfig = JSON.stringify(
          {
            servers: [],
            settings: {
              enabled: true,
            },
          },
          null,
          2
        )

        await fs.writeFileSync(configPath, defaultConfig)
        setConfigContent(defaultConfig)
      }

      setError('')
    } catch (err) {
      console.error('Error reading config file:', err)
      setError('Failed to read config file')
    }
  }, [janDataFolderPath])

  useEffect(() => {
    if (janDataFolderPath) {
      readConfigFile()
    }
  }, [janDataFolderPath, readConfigFile])

  const saveConfigFile = useCallback(async () => {
    try {
      setIsSaving(true)
      setSuccess('')
      setError('')

      // Validate JSON
      try {
        JSON.parse(configContent)
      } catch (err) {
        setError('Invalid JSON format')
        setIsSaving(false)
        return
      }

      const configPath = await joinPath([janDataFolderPath, 'mcp_config.json'])

      // Write to the file
      await fs.writeFileSync(configPath, configContent)

      setSuccess('Config saved successfully')
      setIsSaving(false)
    } catch (err) {
      console.error('Error saving config file:', err)
      setError('Failed to save config file')
      setIsSaving(false)
    }
  }, [janDataFolderPath, configContent])

  return (
    <div className="p-4">
      <h2 className="mb-4 text-xl font-bold">MCP Configuration</h2>

      {error && (
        <div className="mb-4 rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 rounded border border-green-400 bg-green-100 px-4 py-3 text-green-700">
          {success}
        </div>
      )}

      <div className="mb-4">
        <label className="mb-2 block text-sm font-medium">
          Configuration File (JSON)
        </label>
        <textarea
          className="h-80 w-full rounded border border-gray-800 p-2 font-mono text-sm"
          value={configContent}
          onChange={(e) => {
            setConfigContent(e.target.value)
            setSuccess('')
          }}
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={saveConfigFile} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Config'}
        </Button>
      </div>
    </div>
  )
}

export default MCP
