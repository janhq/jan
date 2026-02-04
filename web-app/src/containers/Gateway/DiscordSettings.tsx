import React, { useState, useEffect } from 'react';
import { useGatewayStore, useDiscordBotStatus, useIsGatewayRunning } from '@/hooks/useGateway';

export function DiscordSettings() {
  const { startDiscordBot, stopDiscordBot, fetchDiscordBotStatus } = useGatewayStore();
  const discordBotStatus = useDiscordBotStatus();
  const isGatewayRunning = useIsGatewayRunning();

  const [botToken, setBotToken] = useState('');
  const [botUserId, setBotUserId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isGatewayRunning) {
      fetchDiscordBotStatus();
    }
  }, [isGatewayRunning, fetchDiscordBotStatus]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsConnecting(true);

    try {
      await startDiscordBot(botToken, botUserId, channelId);
      setBotToken('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setError(null);
    try {
      await stopDiscordBot();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  };

  const isConnected = discordBotStatus?.running ?? false;

  return (
    <div className="p-4 bg-gray-800 rounded-lg">
      <h3 className="text-lg font-semibold text-white mb-4">Discord Bot Setup</h3>

      {!isGatewayRunning && (
        <p className="text-yellow-400 text-sm mb-4">
          Start the Gateway server first to enable Discord bot
        </p>
      )}

      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-3 py-2 rounded mb-4 text-sm">
          {error}
        </div>
      )}

      {isConnected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-green-400">
            <span className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
            <span>Bot is connected and listening for mentions</span>
          </div>
          <div className="text-sm text-gray-400">
            Channel: {discordBotStatus?.channelId}
          </div>
          <button
            onClick={handleDisconnect}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded transition-colors"
          >
            Disconnect Bot
          </button>
        </div>
      ) : (
        <form onSubmit={handleConnect} className="space-y-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Bot Token
            </label>
            <input
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="MTEyMzQ1Njc4OTAxMjM0NTY3ODkw.Yz2dQw..."
              className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              required
              disabled={!isGatewayRunning || isConnecting}
            />
            <p className="text-xs text-gray-500 mt-1">
              Get this from Discord Developer Portal → Bot → Token
            </p>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Bot User ID
            </label>
            <input
              type="text"
              value={botUserId}
              onChange={(e) => setBotUserId(e.target.value)}
              placeholder="123456789012345678"
              className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              required
              disabled={!isGatewayRunning || isConnecting}
            />
            <p className="text-xs text-gray-500 mt-1">
              Right-click bot in Discord → Copy ID (Enable Developer Mode first)
            </p>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Channel ID
            </label>
            <input
              type="text"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              placeholder="123456789012345678"
              className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              required
              disabled={!isGatewayRunning || isConnecting}
            />
            <p className="text-xs text-gray-500 mt-1">
              Right-click channel → Copy ID
            </p>
          </div>

          <button
            type="submit"
            disabled={!isGatewayRunning || isConnecting}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-medium py-2 px-4 rounded transition-colors"
          >
            {isConnecting ? 'Connecting...' : 'Connect Bot'}
          </button>
        </form>
      )}

      <div className="mt-4 p-3 bg-gray-900/50 rounded text-xs text-gray-400">
        <p className="font-semibold mb-1">Setup Instructions:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Create app at discord.com/developers/applications</li>
          <li>Add Bot and copy token</li>
          <li>Enable MESSAGE CONTENT intent in Bot settings</li>
          <li>Invite bot to your server</li>
          <li>Enable Developer Mode in Discord to copy IDs</li>
        </ol>
      </div>
    </div>
  );
}

export default DiscordSettings;