import React, { useState, useEffect, useCallback } from 'react'

import { Button, TextArea } from '@janhq/joi'
import { useAtomValue } from 'jotai'

import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'

const MCPConfiguration = () => {
  const janDataFolderPath = useAtomValue(janDataFolderPathAtom)
  const [configContent, setConfigContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const readConfigFile = useCallback(async () => {
    try {
      // Read the file
      const content = await window.core?.api.getMcpConfigs()
      setConfigContent(content)

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
      await window.core?.api?.saveMcpConfigs({ configs: configContent })

      setSuccess('Config saved successfully')
      setIsSaving(false)
    } catch (err) {
      console.error('Error saving config file:', err)
      setError('Failed to save config file')
      setIsSaving(false)
    }
  }, [janDataFolderPath, configContent])

  return (
    <>
      {error && (
        <div className="mb-4 rounded bg-[hsla(var(--destructive-bg))] px-4 py-3 text-[hsla(var(--destructive-fg))]">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 rounded bg-[hsla(var(--success-bg))] px-4 py-3 text-[hsla(var(--success-fg))]">
          {success}
        </div>
      )}

      <div className="mb-4 mt-2">
        <label className="mb-2 block text-sm font-medium">
          Configuration File (JSON)
        </label>
        <TextArea
          // className="h-80 w-full rounded border border-gray-800 p-2 font-mono text-sm"
          className="font-mono text-xs"
          value={configContent}
          rows={20}
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
    </>
  )
}

export default MCPConfiguration
