import React, { useState, useEffect, useCallback } from 'react'

import { ScrollArea, Tabs } from '@janhq/joi'

import { useAtomValue } from 'jotai'

import MCPConfiguration from './configuration'
import MCPSearch from './search'

import { showScrollBarAtom } from '@/helpers/atoms/Setting.atom'

const MCP = () => {
  const [tabValue, setTabValue] = useState('search_mcp')
  const showScrollBar = useAtomValue(showScrollBarAtom)

  return (
    <ScrollArea
      type={showScrollBar ? 'always' : 'scroll'}
      className="h-full w-full"
    >
      <div className="block w-full px-4 pb-4">
        <div className="sticky top-0 bg-[hsla(var(--app-bg))] py-4">
          <h2 className="mb-4 text-lg font-bold">MCP servers</h2>
          <Tabs
            options={[
              { name: 'Search MCP', value: 'search_mcp' },
              { name: 'Configuration', value: 'config' },
            ]}
            tabStyle="segmented"
            value={tabValue}
            onValueChange={(value) => setTabValue(value as string)}
          />
        </div>
        {tabValue === 'search_mcp' && <MCPSearch />}
        {tabValue === 'config' && <MCPConfiguration />}
      </div>
    </ScrollArea>
  )
}

export default MCP
