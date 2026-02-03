/**
 * Gateway connections hook for managing platform connections
 */

import { useEffect, useState, useCallback } from 'react';
import { createGatewayService } from '../services/gateway';
import type { ConnectionState, Platform } from '../services/gateway';

const gatewayService = createGatewayService();

export function useGatewayConnections() {
  const [connections, setConnections] = useState<ConnectionState[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConnections = useCallback(async () => {
    try {
      const conns = await gatewayService.getConnections();
      setConnections(conns);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch connections');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections();

    // Set up connection change listener
    const unlisten = gatewayService.onConnectionChange((newConnections) => {
      setConnections(newConnections);
    });

    // Refresh connections periodically
    const interval = setInterval(fetchConnections, 10000);

    return () => {
      unlisten();
      clearInterval(interval);
    };
  }, [fetchConnections]);

  return {
    connections,
    isLoading,
    error,
    refetch: fetchConnections,
  };
}

export function useGatewayConnection(platform: Platform) {
  const { connections } = useGatewayConnections();
  const connection = connections.find((c) => c.platform === platform);

  return {
    connected: connection?.connected ?? false,
    messageCount: connection?.messageCount ?? 0,
    lastHeartbeat: connection?.lastHeartbeat ?? 0,
  };
}