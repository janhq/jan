/**
 * ModelScope file list utilities - extracted for testability
 */

export interface ModelScopeFileLike {
  Name?: string
  name?: string
  Path?: string
  path?: string
  Size?: number
  size?: number
  Sha256?: string | null
  sha256?: string | null
  IsLFS?: boolean
  isLFS?: boolean
  is_lfs?: boolean
  Type?: string
  type?: string
}

export interface ModelScopeFileListLike {
  Files?: ModelScopeFileLike[]
  files?: ModelScopeFileLike[]
}

export interface BestGgufFile {
  Name: string
  Path: string
  Size: number
  Sha256: string | null
  IsLFS: boolean
}

export interface FileTreeNode {
  name: string
  path: string
  type: 'dir' | 'file'
  size?: number
  sha256?: string | null
  isLFS?: boolean
  children?: FileTreeNode[]
}

/**
 * Calculate the priority score for a GGUF filename.
 * Higher = more preferred for general use.
 */
export function quantPriority(name: string): number {
  const lower = name.toLowerCase()
  if (lower.includes('q4_k_m')) return 3
  if (lower.includes('q5_k_m')) return 2
  if (lower.includes('q8_0')) return 1
  return 0
}

/**
 * Select the best GGUF file from a ModelScope file list.
 * Supports both PascalCase (Files/Name) and snake_case (files/name) responses.
 *
 * Priority order:
 *   q4_k_m (3) > q5_k_m (2) > q8_0 (1) > others (0)
 *
 * Filters out mmproj files and non-.gguf files.
 */
export function selectBestGgufFile(
  fileList: ModelScopeFileListLike | null | undefined
): BestGgufFile | null {
  // Defensive: support both PascalCase and snake_case
  const files = fileList?.Files ?? (fileList as any)?.files
  if (!files || !Array.isArray(files)) {
    return null
  }

  const ggufs = files.filter((f: ModelScopeFileLike) => {
    const name = (f.Name ?? f.name ?? '').toLowerCase()
    return name.endsWith('.gguf') && !name.includes('mmproj')
  })

  if (ggufs.length === 0) {
    return null
  }

  const sorted = [...ggufs].sort((a: ModelScopeFileLike, b: ModelScopeFileLike) => {
    const aName = (a.Name ?? a.name ?? '').toLowerCase()
    const bName = (b.Name ?? b.name ?? '').toLowerCase()
    return quantPriority(bName) - quantPriority(aName)
  })

  const winner = sorted[0]
  return {
    Name: winner.Name ?? winner.name ?? '',
    Path: winner.Path ?? winner.path ?? '',
    Size: winner.Size ?? winner.size ?? 0,
    Sha256: winner.Sha256 ?? winner.sha256 ?? null,
    IsLFS: winner.IsLFS ?? winner.isLFS ?? winner.is_lfs ?? false,
  }
}

/**
 * Build a hierarchical file tree from a flat ModelScope file list.
 *
 * ModelScope's `Recursive=true` API returns a flat list where:
 *   - Folders have Type="tree" and Size=0
 *   - Files have Type="blob" (or undefined for older APIs) and Size>0
 *   - File Path includes full directory path (e.g. "Q4_K_M/model-00001.gguf")
 *
 * This function reconstructs the tree from Path, ensuring folders are
 * nodes and files are leaf nodes. Empty folders (tree entries with no
 * children) are preserved.
 */
export function buildFileTree(
  files: Array<{
    Name: string
    Path: string
    Size: number
    Sha256: string | null
    IsLFS: boolean
    Type: string
  }>
): FileTreeNode[] {
  const root: FileTreeNode[] = []
  const nodeMap = new Map<string, FileTreeNode>()

  // Ensure a directory node exists for the given path parts.
  function ensureDir(parts: string[]): FileTreeNode {
    const path = parts.join('/')
    const existing = nodeMap.get(path)
    if (existing) return existing

    const name = parts[parts.length - 1]
    const parentPath = parts.slice(0, -1).join('/')
    const parent = parentPath ? nodeMap.get(parentPath) : null

    const node: FileTreeNode = {
      name,
      path,
      type: 'dir',
      children: [],
    }
    nodeMap.set(path, node)

    if (parent && parent.children) {
      parent.children.push(node)
    } else if (!parentPath) {
      root.push(node)
    }
    return node
  }

  // Step 1: Register all tree entries as directory nodes.
  const treeEntries = files.filter((f) => f.Type === 'tree')
  for (const entry of treeEntries) {
    const parts = entry.Path.split('/').filter(Boolean)
    if (parts.length === 0) continue
    ensureDir(parts)
  }

  // Step 2: Register all blob entries as file nodes.
  const blobEntries = files.filter(
    (f) => f.Type !== 'tree'
  )
  for (const entry of blobEntries) {
    const parts = entry.Path.split('/').filter(Boolean)
    if (parts.length === 0) continue

    const fileName = parts.pop()!
    const parent = parts.length > 0 ? ensureDir(parts) : null

    const node: FileTreeNode = {
      name: fileName,
      path: entry.Path,
      type: 'file',
      size: entry.Size,
      sha256: entry.Sha256,
      isLFS: entry.IsLFS,
    }

    if (parent && parent.children) {
      parent.children.push(node)
    } else {
      root.push(node)
    }
  }

  // Step 3: Sort recursively — directories first, then files, alphabetically.
  function sortNodes(nodes: FileTreeNode[]) {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) {
      if (node.children) sortNodes(node.children)
    }
  }
  sortNodes(root)

  return root
}

/**
 * Count total file nodes (non-directory) in a tree.
 */
export function countFileNodes(nodes: FileTreeNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.type === 'file') count++
    if (node.children) count += countFileNodes(node.children)
  }
  return count
}

/**
 * Extract names of all directory nodes from a file tree.
 * Returns them sorted alphabetically.
 */
export function extractQuantVersions(nodes: FileTreeNode[]): string[] {
  const names: string[] = []
  for (const node of nodes) {
    if (node.type === 'dir') {
      names.push(node.name)
    }
    if (node.children) {
      names.push(...extractQuantVersions(node.children))
    }
  }
  return names.sort((a, b) => a.localeCompare(b))
}

/**
 * Calculate total download size from a file tree.
 *
 * @param nodes    Hierarchical file tree nodes.
 * @param quantDir Target quant directory path (e.g. "Q4_K_M"). If null, sums all files.
 * @returns Total size in bytes.
 */
export function calcDownloadSize(
  nodes: FileTreeNode[],
  quantDir: string | null
): number {
  let total = 0
  for (const node of nodes) {
    if (node.type === 'file') {
      if (quantDir === null || node.path.startsWith(quantDir + '/')) {
        total += node.size ?? 0
      }
    }
    if (node.children) {
      total += calcDownloadSize(node.children, quantDir)
    }
  }
  return total
}
