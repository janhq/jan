/**
 * Gateway settings panel component
 */

import React, { useState } from 'react';
import { useGatewayStore } from '../../hooks/useGateway';
import { useGatewayStatus } from '../../hooks/useGatewayStatus';
import type { GatewayConfig } from '../../services/gateway';

export function GatewaySettings() {
  const { status, isLoading, error, refetch } = useGatewayStatus();
  const { startServer, stopServer, isRunning } = useGatewayStore();

  const [httpPort, setHttpPort] = useState(status?.httpPort?.toString() || '4281');
  const [wsPort, setWsPort] = useState(status?.wsPort?.toString() || '4282');
  const [autoCreateThreads, setAutoCreateThreads] = useState(true);

  const handleStart = async () => {
    const gatewayConfig: GatewayConfig = {
      httpPort: parseInt(httpPort, 10),
      wsPort: parseInt(wsPort, 10),
      enabled: true,
      whitelist: {
        enabled: false,
        userIds: [],
        channelIds: [],
        guildIds: [],
        roleIds: [],
      },
      autoCreateThreads,
      defaultAssistantId: null,
    };
    await startServer(gatewayConfig);
  };

  const handleStop = async () => {
    await stopServer();
    refetch();
  };

  const isFormValid = parseInt(httpPort, 10) > 1024 && parseInt(httpPort, 10) < 65535;

  return (
    <div className="gateway-settings">
      <h2>Gateway Settings</h2>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="status-section">
        <h3>Server Status</h3>
        <div className={`status-indicator ${isRunning ? 'running' : 'stopped'}`}>
          {isRunning ? 'Running' : 'Stopped'}
        </div>
        {isLoading && <span>Loading...</span>}
      </div>

      <div className="config-section">
        <h3>Configuration</h3>

        <div className="form-group">
          <label htmlFor="httpPort">HTTP Port</label>
          <input
            id="httpPort"
            type="number"
            value={httpPort}
            onChange={(e) => setHttpPort(e.target.value)}
            disabled={isRunning}
            min={1024}
            max={65535}
          />
        </div>

        <div className="form-group">
          <label htmlFor="wsPort">WebSocket Port</label>
          <input
            id="wsPort"
            type="number"
            value={wsPort}
            onChange={(e) => setWsPort(e.target.value)}
            disabled={isRunning}
            min={1024}
            max={65535}
          />
        </div>

        <div className="form-group checkbox">
          <label>
            <input
              type="checkbox"
              checked={autoCreateThreads}
              onChange={(e) => setAutoCreateThreads(e.target.checked)}
              disabled={isRunning}
            />
            Auto-create threads for new channels
          </label>
        </div>
      </div>

      <div className="actions">
        {!isRunning ? (
          <button
            className="start-button"
            onClick={handleStart}
            disabled={!isFormValid || isLoading}
          >
            Start Gateway
          </button>
        ) : (
          <button
            className="stop-button"
            onClick={handleStop}
            disabled={isLoading}
          >
            Stop Gateway
          </button>
        )}
      </div>

      {status && (
        <div className="status-details">
          <h3>Active Connections</h3>
          <p>{status.activeConnections} connections</p>
          <p>Queued messages: {status.queuedMessages}</p>
        </div>
      )}
    </div>
  );
}

export default GatewaySettings;