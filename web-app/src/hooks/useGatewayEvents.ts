/**
 * Gateway event handling hook
 *
 * This hook provides status change notifications for gateway events.
 *
 * NOTE: Message processing (thread creation, message injection, LLM inference)
 * is handled by useGateway.ts at module level to avoid duplicate processing.
 * This hook only provides status change callbacks.
 */

import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

interface UseGatewayEventsOptions {
  /** Called when gateway status changes */
  onStatusChange?: (running: boolean) => void;
}

export function useGatewayEvents(options: UseGatewayEventsOptions = {}) {
  const { onStatusChange } = options;

  // Listen for gateway status changes only
  useEffect(() => {
    let isMounted = true;
    let unlistenStatus: (() => void) | null = null;

    const setupListener = async () => {
      try {
        unlistenStatus = await listen<{ running: boolean }>(
          'gateway:status',
          (event) => {
            if (isMounted && onStatusChange) {
              onStatusChange(event.payload.running);
            }
          }
        );
      } catch (error) {
        console.error('[GatewayEvents] Failed to set up status listener:', error);
      }
    };

    setupListener();

    return () => {
      isMounted = false;
      if (unlistenStatus) {
        unlistenStatus();
      }
    };
  }, [onStatusChange]);

  return {};
}

export default useGatewayEvents;
