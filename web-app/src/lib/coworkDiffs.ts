import type { CoworkTurn, SubagentRun } from '@/types/coworkSession'

export type CoworkDiffOperation = {
  diff: string
  source: 'main' | 'subagent'
  sourceName?: string
}

export type CoworkFileDiff = {
  path: string
  additions: number
  deletions: number
  operations: CoworkDiffOperation[]
}

function addOperation(
  files: Map<string, CoworkFileDiff>,
  turn: CoworkTurn,
  source: 'main' | 'subagent',
  sourceName?: string
) {
  if (
    turn.role !== 'tool' ||
    (turn.name !== 'write' && turn.name !== 'edit') ||
    turn.isError ||
    turn.status === 'running' ||
    !turn.diff
  ) {
    return
  }
  if (!turn.args || typeof turn.args !== 'object') return

  const path = (turn.args as Record<string, unknown>).path
  if (typeof path !== 'string' || !path.trim()) return

  const lines = turn.diff.split('\n')
  const additions = lines.filter((line) => line.startsWith('+ ')).length
  const deletions = lines.filter((line) => line.startsWith('- ')).length
  const operation: CoworkDiffOperation = sourceName
    ? { diff: turn.diff, source, sourceName }
    : { diff: turn.diff, source }
  const current = files.get(path)

  if (current) {
    current.additions += additions
    current.deletions += deletions
    current.operations.push(operation)
    return
  }

  files.set(path, { path, additions, deletions, operations: [operation] })
}

export function collectCodeFileDiffs(
  turns: CoworkTurn[],
  subagents: SubagentRun[]
): CoworkFileDiff[] {
  const files = new Map<string, CoworkFileDiff>()

  for (const turn of turns) {
    addOperation(files, turn, 'main')
  }

  for (const run of subagents) {
    for (const turn of run.turns) {
      addOperation(files, turn, 'subagent', run.name)
    }
  }

  return [...files.values()]
}
