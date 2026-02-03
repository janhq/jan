/**
 * Gateway Status Component
 *
 * Displays current gateway status and connections.
 */

import React from 'react';
import { useGatewayStore, useGatewayStatus, useGatewayConnections } from '../../hooks/useGateway';
import { useGatewayThreadMappings } from '../../hooks/useGateway';
import type { GatewayStatus, Platform } from '../../services/gateway';

interface GatewayStatusProps {
  /** Show detailed status */
  detailed?: boolean;
  /** Refresh interval in ms */
  refreshInterval?: number;
}

export function GatewayStatus({
  detailed = true,
  refreshInterval = 5000,
}: GatewayStatusProps) {
  const status = useGatewayStatus();
  const connections = useGatewayConnections();
  const threadMappings = useGatewayThreadMappings();
  const { fetchStatus, isRunning, stopServer } = useGatewayStore();

  // Auto-refresh status
  React.useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      fetchStatus();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [isRunning, fetchStatus, refreshInterval]);

  if (!status) {
    return (
      <div className="gateway-status gateway-status--offline">
        <div className="gateway-status__indicator" />
        <span>Gateway Offline</span>
      </div>
    );
  }

  const platformColors: Record<Platform, string> = {
    discord: '#5865F2',
    slack: '#4A154B',
    telegram: '#0088cc',
    unknown: '#888888',
  };

  const formatTimestamp = (ts: number): string => {
    return new Date(ts).toLocaleTimeString();
  };

  return (
    <div className={`gateway-status ${status.running ? 'online' : 'offline'}`}>
      {/* Main Status Indicator */}
      <div className="gateway-status__main">
        <div className="gateway-status__indicator">
          {status.running ? '●' : '○'}
        </div>
        <div className="gateway-status__info">
          <span className="gateway-status__state">
            {status.running ? 'Running' : 'Stopped'}
          </span>
          {detailed && status.running && (
            <span className="gateway-status__ports">
              HTTP:{status.httpPort} WS:{status.wsPort}
            </span>
          )}
        </div>
      </div>

      {detailed && status.running && (
        <>
          {/* Quick Stats */}
          <div className="gateway-status__stats">
            <div className="stat">
              <span className="stat__value">{status.activeConnections}</span>
              <span className="stat__label">Connections</span>
            </div>
            <div className="stat">
              <span className="stat__value">{status.queuedMessages}</span>
              <span className="stat__label">Queued</span>
            </div>
            <div className="stat">
              <span className="stat__value">{threadMappings.length}</span>
              <span className="stat__label">Threads</span>
            </div>
          </div>

          {/* Active Connections */}
          {connections.length > 0 && (
            <div className="gateway-status__connections">
              <h5>Active Connections</h5>
              <div className="connections-list">
                {connections.map((conn) => (
                  <div
                    key={conn.platform}
                    className={`connection connection--${conn.connected ? 'connected' : 'disconnected'}`}
                  >
                    <span
                      className="connection__platform"
                      style={{ color: platformColors[conn.platform] }}
                    >
                      {conn.platform}
                    </span>
                    <span className="connection__count">
                      {conn.messageCount} msgs
                    </span>
                    <span className="connection__time">
                      {formatTimestamp(conn.lastHeartbeat)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Thread Mappings */}
          {threadMappings.length > 0 && (
            <div className="gateway-status__threads">
              <h5>Thread Mappings ({threadMappings.length})</h5>
              <div className="threads-list">
                {threadMappings.slice(0, 5).map((mapping) => (
                  <div key={`${mapping.platform}-${mapping.externalId}`} className="thread-mapping">
                    <span
                      className="thread-mapping__platform"
                      style={{ color: platformColors[mapping.platform] }}
                    >
                      {mapping.platform}
                    </span>
                    <span className="thread-mapping__channel">
                      {formatChannelId(mapping.externalId)}
                    </span>
                    <span className="thread-mapping__date">
                      {formatTimestamp(mapping.createdAt)}
                    </span>
                  </div>
                ))}
                {threadMappings.length > 5 && (
                  <div className="threads-list__more">
                    +{threadMappings.length - 5} more threads
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="gateway-status__actions">
            <button
              className="btn btn--sm btn--secondary"
              onClick={() => fetchStatus()}
            >
              Refresh
            </button>
            <button
              className="btn btn--sm btn--danger"
              onClick={() => stopServer()}
            >
              Stop
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Format channel ID for display (truncate if too long) */
function formatChannelId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.substring(0, 6)}...${id.substring(id.length - 4)}`;
}

export default GatewayStatus;