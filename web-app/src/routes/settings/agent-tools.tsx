import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Card, CardItem } from '@/containers/Card'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  IconFolderCode,
  IconTrash,
  IconPencil,
  IconLock,
  IconLockOpen,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useAgentToolsConfig } from '@/hooks/useAgentToolsConfig'
import { getSandboxStatus } from '@/lib/agentTools'
import type { SandboxStatus } from '@janhq/tauri-plugin-agent-tools-api'
import {
  storePath,
  revealStore,
  listSkills,
  readSkill,
  writeSkill,
  deleteSkill,
  listMemories,
  readMemory,
  writeMemory,
  deleteMemory,
  type SkillMeta,
} from '@/lib/agentWorkspace'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.agent_tools as any)({
  component: AgentToolsContent,
})

type EntryKind = 'memory' | 'skill'

/** An open editor. `original` is unset when creating, which is what unlocks the
 * name field: renaming an existing entry would mean a write plus a delete. */
type Editor = {
  kind: EntryKind
  original?: string
  name: string
  content: string
}

const messageOf = (e: unknown): string =>
  e && typeof e === 'object' && 'message' in e
    ? String((e as { message: unknown }).message)
    : String(e)

const SKILL_TEMPLATE = '---\ndescription: \n---\n\n'

function AgentToolsContent() {
  const { t } = useTranslation()
  const agentToolsEnabled = useAgentToolsConfig((s) => s.agentToolsEnabled)
  const setAgentToolsEnabled = useAgentToolsConfig(
    (s) => s.setAgentToolsEnabled
  )
  const bashNetworkEnabled = useAgentToolsConfig((s) => s.bashNetworkEnabled)
  const setBashNetworkEnabled = useAgentToolsConfig(
    (s) => s.setBashNetworkEnabled
  )
  // `undefined` until the probe answers, so the row reads as "checking" rather
  // than briefly claiming there is no sandbox.
  const [sandbox, setSandbox] = useState<SandboxStatus | undefined>()

  const [path, setPath] = useState('')
  const [skills, setSkills] = useState<SkillMeta[]>([])
  const [memories, setMemories] = useState<string[]>([])
  const [editor, setEditor] = useState<Editor | null>(null)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [nextPath, nextSkills, nextMemories] = await Promise.all([
        storePath(),
        listSkills(),
        listMemories(),
      ])
      setPath(nextPath)
      setSkills(nextSkills)
      setMemories(nextMemories)
    } catch (e) {
      toast.error(t('settings:agentTools.loadFailed'), {
        description: messageOf(e),
      })
    }
  }, [t])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    getSandboxStatus().then(setSandbox)
  }, [])

  const openEditor = async (kind: EntryKind, name?: string) => {
    if (!name) {
      setEditor({
        kind,
        name: '',
        content: kind === 'skill' ? SKILL_TEMPLATE : '',
      })
      return
    }
    try {
      const content =
        kind === 'skill' ? await readSkill(name) : await readMemory(name)
      setEditor({ kind, original: name, name, content })
    } catch (e) {
      toast.error(t('settings:agentTools.loadFailed'), {
        description: messageOf(e),
      })
    }
  }

  const save = async () => {
    if (!editor) return
    const name = editor.name.trim()
    if (!name) return
    setSaving(true)
    try {
      if (editor.kind === 'skill') await writeSkill(name, editor.content)
      else await writeMemory(name, editor.content)
      setEditor(null)
      await refresh()
    } catch (e) {
      toast.error(t('settings:agentTools.saveFailed'), {
        description: messageOf(e),
      })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (kind: EntryKind, name: string) => {
    try {
      if (kind === 'skill') await deleteSkill(name)
      else await deleteMemory(name)
      await refresh()
    } catch (e) {
      toast.error(t('settings:agentTools.deleteFailed'), {
        description: messageOf(e),
      })
    }
  }

  const reveal = async () => {
    try {
      await revealStore()
    } catch (e) {
      toast.error(t('settings:agentTools.revealFailed'), {
        description: messageOf(e),
      })
    }
  }

  const entryRow = (
    kind: EntryKind,
    name: string,
    description?: string
  ) => (
    <CardItem
      key={`${kind}-${name}`}
      title={name}
      description={description}
      actions={
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            title={t('common:edit')}
            onClick={() => openEditor(kind, name)}
          >
            <IconPencil size={16} className="text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            title={t('common:delete')}
            onClick={() => remove(kind, name)}
          >
            <IconTrash size={16} className="text-destructive" />
          </Button>
        </div>
      }
    />
  )

  const sectionHeader = (titleKey: string, kind: EntryKind) => (
    <div className="flex items-center justify-between">
      <h1 className="text-foreground font-studio font-medium text-base mb-2">
        {t(titleKey)}
      </h1>
      <Button variant="outline" size="sm" onClick={() => openEditor(kind)}>
        {t('settings:agentTools.add')}
      </Button>
    </div>
  )

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            <Card
              header={
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="space-y-1">
                    <h1 className="text-foreground font-studio font-medium text-base">
                      {t('settings:agentTools.title')}
                    </h1>
                    <p className="text-muted-foreground leading-normal">
                      {t('settings:agentTools.description')}
                    </p>
                  </div>
                  {/* The path is a tooltip, not a row: it derives from the Jan
                      data folder that Settings > General already owns. */}
                  <Button
                    variant="link"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    title={path}
                    onClick={reveal}
                    disabled={!path}
                  >
                    <IconFolderCode size={16} />
                    {t('settings:agentTools.openFolder')}
                  </Button>
                </div>
              }
            >
              <CardItem
                title={t('settings:agentTools.enable')}
                description={t('settings:agentTools.enableDesc')}
                align="start"
                actions={
                  <Switch
                    checked={agentToolsEnabled}
                    onCheckedChange={setAgentToolsEnabled}
                  />
                }
              />
              <CardItem
                title={t('settings:agentTools.shell')}
                align="start"
                description={
                  <span className="flex items-start gap-1.5">
                    {sandbox?.enforces ? (
                      <IconLock size={14} className="mt-0.5 shrink-0" />
                    ) : (
                      <IconLockOpen
                        size={14}
                        className="mt-0.5 shrink-0 text-destructive"
                      />
                    )}
                    <span>
                      {sandbox === undefined
                        ? t('settings:agentTools.shellChecking')
                        : sandbox.enforces
                          ? t('settings:agentTools.shellSandboxed', {
                              backend: sandbox.backend,
                            })
                          : t('settings:agentTools.shellUnavailable')}
                    </span>
                  </span>
                }
              />
              {/* Only offered where it can be enforced: with no backend there is
                  no shell to give network access to in the first place. */}
              {sandbox?.enforces && (
                <CardItem
                  title={t('settings:agentTools.network')}
                  description={t('settings:agentTools.networkDesc')}
                  align="start"
                  actions={
                    <Switch
                      checked={bashNetworkEnabled}
                      onCheckedChange={setBashNetworkEnabled}
                      disabled={!agentToolsEnabled}
                    />
                  }
                />
              )}
            </Card>

            <Card header={sectionHeader('settings:agentTools.memories', 'memory')}>
              {memories.length === 0 ? (
                <CardItem
                  description={t('settings:agentTools.noMemories')}
                />
              ) : (
                memories.map((name) => entryRow('memory', name))
              )}
            </Card>

            <Card header={sectionHeader('settings:agentTools.skills', 'skill')}>
              {skills.length === 0 ? (
                <CardItem description={t('settings:agentTools.noSkills')} />
              ) : (
                skills.map((skill) =>
                  entryRow('skill', skill.name, skill.description)
                )
              )}
            </Card>
          </div>
        </div>
      </div>

      <Dialog
        open={editor !== null}
        onOpenChange={(open) => !open && setEditor(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t(
                editor?.kind === 'skill'
                  ? 'settings:agentTools.editSkill'
                  : 'settings:agentTools.editMemory'
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                editor?.kind === 'skill'
                  ? 'settings:agentTools.editSkillDesc'
                  : 'settings:agentTools.editMemoryDesc'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="text"
              placeholder={t('settings:agentTools.namePlaceholder')}
              value={editor?.name ?? ''}
              // Locked once the entry exists: a new name would create a second
              // entry rather than rename this one.
              disabled={editor?.original !== undefined}
              onChange={(e) =>
                setEditor((prev) =>
                  prev ? { ...prev, name: e.target.value } : prev
                )
              }
            />
            <Textarea
              className="min-h-64 font-mono text-xs"
              placeholder={t('settings:agentTools.contentPlaceholder')}
              value={editor?.content ?? ''}
              onChange={(e) =>
                setEditor((prev) =>
                  prev ? { ...prev, content: e.target.value } : prev
                )
              }
            />
          </div>
          <DialogFooter>
            <Button variant="link" onClick={() => setEditor(null)}>
              {t('common:cancel')}
            </Button>
            <Button
              onClick={save}
              disabled={saving || !editor?.name.trim()}
            >
              {t('common:save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
