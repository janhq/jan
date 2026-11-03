import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { SystemEvent } from '@/types/events';
import { getServiceHub } from '@/hooks/useServiceHub';
import { useAppState } from './useAppState';

export function usePrompts() {
  const updatePrompts = useAppState((state) => state.updateMcpPrompts);

  useEffect(() => {
    const fetchPrompts = async () => {
      try {
        const prompts = await getServiceHub().mcp().getPrompts();
        updatePrompts(prompts);
      } catch (err) {
        console.error('Failed to fetch MCP prompts: ', err)
      }
    }
    fetchPrompts()

    const unlisten = listen(SystemEvent.MCP_UPDATE, fetchPrompts)
    return () => {
      unlisten.then((f) => f())
    }
  }, [updatePrompts])
}