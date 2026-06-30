/**
 * Tauri agent service - desktop implementation. Bridges the Rust `agent_run`
 * command's `Channel<StreamEvent>` onto an `onEvent` callback.
 */

import { Channel, invoke } from '@tauri-apps/api/core'
import type { AgentRunBody, StreamEvent } from './types'
import { DefaultAgentService } from './default'

export class TauriAgentService extends DefaultAgentService {
  async run(
    runId: string,
    body: AgentRunBody,
    onEvent: (event: StreamEvent) => void
  ): Promise<void> {
    const channel = new Channel<StreamEvent>()
    channel.onmessage = onEvent
    try {
      await invoke<void>('agent_run', { runId, body, onEvent: channel })
    } catch (error) {
      console.error(`Error invoking agent_run for '${runId}':`, error)
      throw error
    }
  }

  async cancel(runId: string): Promise<void> {
    try {
      await invoke<void>('agent_cancel', { runId })
    } catch (error) {
      console.error(`Error invoking agent_cancel for '${runId}':`, error)
      throw error
    }
  }
}
