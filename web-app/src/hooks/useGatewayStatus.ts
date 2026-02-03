/**
 * Gateway status hook for reactive status updates
 */

import { useEffect, useState, useCallback } from 'react';
import type { GatewayStatus } from '../services/gateway';

const gatewayService = createGatewayService();

export function useGatewayStatus() {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const currentStatus = await gatewayService.getStatus();
      setStatus(currentStatus);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    // Set up status change listener
    const unlisten = gatewayService.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });

    // Refresh status periodically
    const interval = setInterval(fetchStatus, 5000);

    return () => {
      unlisten();
      clearInterval(interval);
    };
  }, [fetchStatus]);

  return {
    status,
    isLoading,
    error,
    refetch: fetchStatus,
  };
}

export function useIsGatewayRunning() {
  const { status, isLoading } = useGatewayStatus();
  return { isRunning: status?.running ?? false, isLoading };
}

export function useGatewayConnectionCount() {
  const { status } = useGatewayStatus();
  return status?.activeConnections ?? 0;
}