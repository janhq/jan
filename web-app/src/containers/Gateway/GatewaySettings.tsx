/**
 * Gateway Settings Component
 *
 * UI for configuring gateway settings.
 */

import React, { useState, useEffect } from 'react';
import { useGatewayStore } from '../../hooks/useGateway';
import { useGatewayStatus, useIsGatewayRunning } from '../../hooks/useGateway';
import type { GatewayConfig } from '../../services/gateway';

interface GatewaySettingsProps {
  /** Called when settings are saved */
  onSave?: (config: GatewayConfig) => void;
  /** Called when gateway is started/stopped */
  onToggle?: (running: boolean) => void;
}

export function GatewaySettings({ onSave, onToggle }: GatewaySettingsProps) {
  const { startServer, stopServer, isLoading, error, clearError } = useGatewayStore();
  const status = useGatewayStatus();
  const isRunning = useIsGatewayRunning();

  // Configuration state
  const [httpPort, setHttpPort] = useState(4281);
  const [wsPort, setWsPort] = useState(4282);
  const [autoCreateThreads, setAutoCreateThreads] = useState(true);
  const [defaultAssistantId, setDefaultAssistantId] = useState<string | null>(null);

  // Whitelist state
  const [whitelistEnabled, setWhitelistEnabled] = useState(false);
  const [whitelistUsers, setWhitelistUsers] = useState('');
  const [whitelistChannels, setWhitelistChannels] = useState('');
  const [whitelistGuilds, setWhitelistGuilds] = useState('');

  // UI state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load current config
  useEffect(() => {
    if (status) {
      setHttpPort(status.httpPort || 4281);
      setWsPort(status.wsPort || 4282);
      setEnabled(status.running);
    }
  }, [status]);

  const handleStart = async () => {
    try {
      clearError();
      const config: GatewayConfig = {
        httpPort,
        wsPort,
        enabled: true,
        whitelist: {
          enabled: whitelistEnabled,
          userIds: parseList(whitelistUsers),
          channelIds: parseList(whitelistChannels),
          guildIds: parseList(whitelistGuilds),
          roleIds: [],
        },
        autoCreateThreads,
        defaultAssistantId,
      };

      await startServer(config);
      onSave?.(config);
      onToggle?.(true);
    } catch (err) {
      console.error('Failed to start gateway:', err);
    }
  };

  const handleStop = async () => {
    try {
      clearError();
      await stopServer();
      onToggle?.(false);
    } catch (err) {
      console.error('Failed to stop gateway:', err);
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      // Stop and restart with new config
      if (isRunning) {
        await handleStop();
      }

      const config: GatewayConfig = {
        httpPort,
        wsPort,
        enabled: false,
        whitelist: {
          enabled: whitelistEnabled,
          userIds: parseList(whitelistUsers),
          channelIds: parseList(whitelistChannels),
          guildIds: parseList(whitelistGuilds),
          roleIds: [],
        },
        autoCreateThreads,
        defaultAssistantId,
      };

      // Save config (would call backend command)
      await invoke('gateway_save_config', { config });

      onSave?.(config);
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  };

  const parseList = (str: string): string[] => {
    return str
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  };

  return (
    <div className="gateway-settings">
      <div className="gateway-settings__header">
        <h3>Gateway Settings</h3>
        <div className={`gateway-status ${isRunning ? 'running' : 'stopped'}`}>
          {isRunning ? '● Running' : '○ Stopped'}
        </div>
      </div>

      {error && (
        <div className="gateway-settings__error">
          <span>{error}</span>
          <button onClick={clearError}>×</button>
        </div>
      )}

      <div className="gateway-settings__content">
        {/* Server Configuration */}
        <section className="gateway-settings__section">
          <h4>Server Configuration</h4>

          <div className="gateway-settings__row">
            <label>
              HTTP Port
              <input
                type="number"
                value={httpPort}
                onChange={(e) => setHttpPort(parseInt(e.target.value, 10))}
                disabled={isRunning}
                min="1024"
                max="65535"
              />
            </label>

            <label>
              WebSocket Port
              <input
                type="number"
                value={wsPort}
                onChange={(e) => setWsPort(parseInt(e.target.value, 10))}
                disabled={isRunning}
                min="1024"
                max="65535"
              />
            </label>
          </div>
        </section>

        {/* Thread Settings */}
        <section className="gateway-settings__section">
          <h4>Thread Settings</h4>

          <label className="gateway-settings__checkbox">
            <input
              type="checkbox"
              checked={autoCreateThreads}
              onChange={(e) => setAutoCreateThreads(e.target.checked)}
            />
            Auto-create threads for new channels
          </label>

          {autoCreateThreads && (
            <label>
              Default Assistant
              <input
                type="text"
                value={defaultAssistantId || ''}
                onChange={(e) => setDefaultAssistantId(e.target.value || null)}
                placeholder="Select an assistant..."
              />
            </label>
          )}
        </section>

        {/* Whitelist Settings */}
        <section className="gateway-settings__section">
          <h4>
            <button
              className="gateway-settings__toggle"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? '▼' : '▶'} Whitelist
            </button>
          </h4>

          {showAdvanced && (
            <>
              <label className="gateway-settings__checkbox">
                <input
                  type="checkbox"
                  checked={whitelistEnabled}
                  onChange={(e) => setWhitelistEnabled(e.target.checked)}
                />
                Enable whitelist filtering
              </label>

              {whitelistEnabled && (
                <>
                  <label>
                    Allowed Users (comma-separated IDs)
                    <textarea
                      value={whitelistUsers}
                      onChange={(e) => setWhitelistUsers(e.target.value)}
                      placeholder="e.g., 123456789, 987654321"
                      rows={2}
                    />
                  </label>

                  <label>
                    Allowed Channels (comma-separated IDs)
                    <textarea
                      value={whitelistChannels}
                      onChange={(e) => setWhitelistChannels(e.target.value)}
                      placeholder="e.g., 111222333, 444555666"
                      rows={2}
                    />
                  </label>

                  <label>
                    Allowed Guilds/Servers (comma-separated IDs)
                    <textarea
                      value={whitelistGuilds}
                      onChange={(e) => setWhitelistGuilds(e.target.value)}
                      placeholder="e.g., 777888999"
                      rows={2}
                    />
                  </label>
                </>
              )}
            </>
          )}
        </section>

        {/* Webhook URLs (display only) */}
        {isRunning && (
          <section className="gateway-settings__section">
            <h4>Webhook URLs</h4>
            <div className="gateway-settings__webhooks">
              <div className="webhook-url">
                <span className="platform discord">Discord</span>
                <code>http://localhost:{httpPort}/webhook/discord</code>
              </div>
              <div className="webhook-url">
                <span className="platform slack">Slack</span>
                <code>http://localhost:{httpPort}/webhook/slack</code>
              </div>
              <div className="webhook-url">
                <span className="platform telegram">Telegram</span>
                <code>http://localhost:{httpPort}/webhook/telegram</code>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Actions */}
      <div className="gateway-settings__actions">
        {!isRunning ? (
          <button
            className="btn btn--primary"
            onClick={handleStart}
            disabled={isLoading}
          >
            {isLoading ? 'Starting...' : 'Start Gateway'}
          </button>
        ) : (
          <button
            className="btn btn--danger"
            onClick={handleStop}
            disabled={isLoading}
          >
            {isLoading ? 'Stopping...' : 'Stop Gateway'}
          </button>
        )}

        <button
          className="btn btn--secondary"
          onClick={handleSaveConfig}
          disabled={saving || isRunning}
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
}

export default GatewaySettings;