import type { Tool } from 'ai'
import { CustomChatTransport } from '@/lib/custom-chat-transport'
import { COWORK_SLOT_ID } from '@/constants/models'
import {
  getMemoryCatalog,
  sandboxEnforces,
  type MemoryCatalogEntry,
} from '@/lib/agentTools'
import {
  buildCoworkTools,
  coworkToolSignature,
  type CoworkToolOptions,
} from '@/lib/coworkTools'
import {
  buildCoworkSystemPrompt,
  type CoworkEnvironment,
} from '@/lib/coworkPrompt'
import { getCoworkEnvironment } from '@/lib/coworkEnv'

export type CoworkRunConfig = CoworkToolOptions & {
  workspacePath: string | null
  readOnlyFolder: string | null
}

/**
 * The chat transport, re-aimed at an agent run.
 *
 * Everything expensive is inherited: model creation and its abort-during-load
 * unload, the sampling/reasoning merge, attachment encoding, tool-call repair,
 * and the usage metadata. Only four things differ, and each is a seam on the
 * parent.
 */
export class CoworkChatTransport extends CustomChatTransport {
  private config: CoworkRunConfig
  /**
   * The advertised tool set, frozen for a run's lifetime.
   *
   * An agent turn calls `sendMessages` many times, and any change to the tool
   * JSON changes the prompt prefix, discarding the KV cache on every step. A
   * mode change therefore applies at the next message, not mid-run.
   */
  private frozenTools: Record<string, Tool> | null = null
  /** Last set actually built, kept across runs so an unchanged config does not
   * pay for a rebuild at every run boundary. */
  private builtTools: Record<string, Tool> | null = null
  private builtSig = ''
  /**
   * The memory catalog advertised this run. Snapshotted with the tool freeze,
   * for the same reason: a mid-run change to the prompt prefix discards the KV
   * cache on every step. A note written mid-run appears at the next run.
   */
  private memoryCatalog: MemoryCatalogEntry[] = []
  /** Snapshotted with the tool freeze: the date line changing mid-run would
   * discard the prompt prefix on every step, exactly like a catalog change. */
  private environment: CoworkEnvironment | null = null

  constructor(sessionId: string, config: CoworkRunConfig) {
    super(undefined, sessionId)
    this.config = config
  }

  /** Applied at the next run: changing it mid-run would invalidate the prefix. */
  setConfig(config: CoworkRunConfig) {
    this.config = config
  }

  /** Drop the freeze so the next run re-reads the config. */
  unfreezeTools() {
    this.frozenTools = null
  }

  /**
   * The set actually advertised this run, for narrowing a subagent's tools.
   *
   * A child's allowlist intersects with this rather than with the full built-in
   * list, so plan mode and a withheld `bash` propagate to children for free.
   */
  get advertisedTools(): Record<string, Tool> {
    return this.frozenTools ?? this.tools
  }

  /** Cowork gets its own llama.cpp slot: sharing chat's would evict the viewed
   * thread's prefix on every one of this turn's many prefills, and vice versa. */
  protected override slotParams(threadId?: string): Record<string, unknown> {
    return { id_slot: COWORK_SLOT_ID, thread_id: `cowork:${threadId ?? ''}` }
  }

  /**
   * Cowork's own prompt replaces the chat one wholesale — the agent-tools and
   * web-search blurbs are written for a chat that occasionally reaches for a
   * tool, not for a run whose whole purpose is tool use. Attached documents
   * need no instruction here either: they are copied into the workspace and
   * named in the question itself (`withAttachedFiles`).
   */
  protected override buildSystemPrompt(): string {
    return buildCoworkSystemPrompt({
      workspacePath: this.config.workspacePath,
      readOnlyFolder: this.config.readOnlyFolder,
      planMode: this.config.planMode,
      bashAvailable: sandboxEnforces(),
      subagentNames: this.config.allowSubagents ? this.config.subagentNames : [],
      webSearch: this.config.webSearch,
      memoryCatalog: this.memoryCatalog,
      environment: this.environment,
    })
  }

  /**
   * An agent run legitimately reaches a window whose only user turn is far
   * back, and tool results are the recent traffic. The parent's guard exists
   * for chat, where a window with no user turn means eviction ate the question;
   * here it would abort a healthy long run.
   */
  protected override assertSendable(): void {}

  override async refreshTools(): Promise<void> {
    // Frozen means frozen: once a run is under way the advertised set is fixed
    // even if the config changed, because rebuilding it would change the tool
    // JSON and discard the prompt prefix on the next of this turn's many
    // prefills. `unfreezeTools()` at the run boundary is what lets it move.
    if (this.frozenTools) {
      this.tools = this.frozenTools
      return
    }
    // Run boundary: re-snapshot the catalog even when the tool set is reused,
    // since memory moves independently of the tool config.
    this.memoryCatalog = await getMemoryCatalog()
    this.environment = await getCoworkEnvironment()
    const sig = coworkToolSignature(this.config, sandboxEnforces())
    // Between runs, skip the rebuild when nothing that shapes the set changed.
    if (this.builtTools && this.builtSig === sig) {
      this.frozenTools = this.builtTools
      this.tools = this.builtTools
      return
    }
    const tools = await buildCoworkTools(this.config)
    this.builtTools = tools
    this.builtSig = sig
    this.frozenTools = tools
    this.tools = tools
  }
}
