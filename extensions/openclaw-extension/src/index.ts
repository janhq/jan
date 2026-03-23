import { Extension, SettingComponentProps } from '@janhq/core';

export default class OpenClawIntegration extends Extension {
  async onLoad() {
    const settings: SettingComponentProps[] = [
      {
        id: 'openclaw_enabled',
        type: 'toggle',
        label: 'Enable OpenClaw Integration',
        description: 'Connect Jan to OpenClaw for Telegram & WhatsApp automation.',
        default: false,
      },
      {
        id: 'openclaw_gateway_url',
        type: 'text',
        label: 'OpenClaw Gateway URL',
        description: 'The URL of your OpenClaw gateway (e.g., http://localhost:18789)',
        default: 'http://localhost:18789',
      },
      {
        id: 'openclaw_telegram_enabled',
        type: 'toggle',
        label: 'Telegram Channel',
        description: 'Route messages through Telegram.',
        default: true,
      },
      {
        id: 'openclaw_whatsapp_enabled',
        type: 'toggle',
        label: 'WhatsApp Channel',
        description: 'Route messages through WhatsApp.',
        default: true,
      }
    ];
    await this.registerSettings(settings);
  }
}
