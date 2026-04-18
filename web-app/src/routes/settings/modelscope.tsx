import { createFileRoute } from '@tanstack/react-router'
import { invoke } from '@tauri-apps/api/core'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useEffect, useState, useCallback } from 'react'
import {
  IconExternalLink,
  IconTrash,
  IconFolder,
  IconPlus,
} from '@tabler/icons-react'
import { toast } from 'sonner'

export const Route = createFileRoute(route.settings.modelscope as any)({
  component: ModelScopeSettings,
})

function ModelScopeSettings() {
  useTranslation()
  const [token, setToken] = useState<string>('')
  const [savedToken, setSavedToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [scanPaths, setScanPaths] = useState<string[]>([])
  const [pathsLoading] = useState(false)

  const fetchPaths = useCallback(async () => {
    try {
      const paths = await invoke<string[]>('get_gguf_scan_paths')
      setScanPaths(paths)
    } catch (e) {
      console.error('Failed to fetch scan paths:', e)
    }
  }, [])

  useEffect(() => {
    invoke<string | null>('get_modelscope_token')
      .then((t) => {
        setSavedToken(t)
        if (t) setToken(t)
      })
      .catch(() => setSavedToken(null))
    fetchPaths()
  }, [fetchPaths])

  const handleSave = async () => {
    setLoading(true)
    try {
      if (token.trim()) {
        await invoke('save_modelscope_token', { token: token.trim() })
        setSavedToken(token.trim())
        toast.success('ModelScope 访问令牌已保存')
      } else {
        await invoke('clear_modelscope_token')
        setSavedToken(null)
        toast.success('ModelScope 访问令牌已清除')
      }
    } catch (err) {
      toast.error('保存失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(false)
    }
  }

  const handleClear = async () => {
    setLoading(true)
    try {
      await invoke('clear_modelscope_token')
      setSavedToken(null)
      setToken('')
      toast.success('ModelScope 访问令牌已清除')
    } catch (err) {
      toast.error('清除失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(false)
    }
  }

  const handleAddPath = async () => {
    try {
      const result = await invoke<string | string[] | null>('open_dialog', {
        options: { directory: true, multiple: false, title: '选择模型文件夹' },
      })
      if (!result) return
      const newPath = Array.isArray(result) ? result[0] : result
      if (scanPaths.includes(newPath)) {
        toast.info('该路径已存在')
        return
      }
      const updated = [...scanPaths, newPath]
      await invoke('set_gguf_scan_paths', { paths: updated })
      setScanPaths(updated)
      toast.success('搜索路径已添加')
    } catch (err) {
      toast.error('添加失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const handleRemovePath = async (path: string) => {
    try {
      const updated = scanPaths.filter((p) => p !== path)
      await invoke('set_gguf_scan_paths', { paths: updated })
      setScanPaths(updated)
      toast.success('搜索路径已移除')
    } catch (err) {
      toast.error('移除失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  return (
    <div className="flex h-full">
      <SettingsMenu />
      <div className="flex h-full w-full bg-[hsla(var(--app-bg))]">
        <div className="h-full w-full overflow-y-auto">
          <div className="px-4 py-6">
            <HeaderPage>
              <h1 className="text-lg font-semibold">ModelScope 模型市场</h1>
            </HeaderPage>

            <div className="mt-6 space-y-6">
              <Card title="访问令牌">
                <div className="text-sm text-muted-foreground mb-4">
                  配置 ModelScope 访问令牌后，可以查看模型详情（README、文件列表等）。
                  列表浏览不需要令牌。
                  <a
                    href="https://www.modelscope.cn/my/myaccesstoken"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline ml-1"
                  >
                    前往获取 <IconExternalLink size={12} />
                  </a>
                </div>

                <CardItem
                  title="Access Token"
                  description={
                    <div className="w-full max-w-md">
                      <input
                        type="password"
                        placeholder="输入你的 ModelScope Access Token"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        className="w-full px-3 py-2 rounded border border-border bg-background text-sm"
                      />
                      {savedToken && (
                        <p className="text-xs text-green-600 mt-1">
                          当前已配置令牌（{savedToken.slice(0, 8)}...{savedToken.slice(-4)}）
                        </p>
                      )}
                    </div>
                  }
                  actions={
                    <div className="flex items-center gap-2">
                      {savedToken && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleClear}
                          disabled={loading}
                        >
                          <IconTrash size={14} className="mr-1" />
                          清除
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={loading}
                      >
                        {loading ? '保存中...' : '保存'}
                      </Button>
                    </div>
                  }
                />
              </Card>

              <Card title="本地模型搜索路径">
                <div className="text-sm text-muted-foreground mb-4">
                  以下路径中的 *.gguf 模型文件将被自动扫描并显示在推理中心的"本地 GGUF 模型"中。
                </div>

                {scanPaths.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-2">
                    暂无自定义搜索路径，默认扫描数据目录下的 llamacpp/models 文件夹。
                  </div>
                ) : (
                  <div className="rounded-lg border border-border overflow-hidden mb-4">
                    <div className="divide-y divide-border/50">
                      {scanPaths.map((path) => (
                        <div
                          key={path}
                          className="flex items-center gap-3 px-4 py-3"
                        >
                          <IconFolder
                            size={16}
                            className="text-muted-foreground shrink-0"
                          />
                          <span className="text-sm text-foreground flex-1 truncate font-mono">
                            {path}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-destructive"
                            onClick={() => handleRemovePath(path)}
                          >
                            <IconTrash size={14} className="mr-1" />
                            移除
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddPath}
                    disabled={pathsLoading}
                  >
                    <IconPlus size={14} className="mr-1" />
                    添加路径
                  </Button>
                </div>
              </Card>

              <Card title="关于 ModelScope">
                <div className="text-sm text-muted-foreground space-y-2">
                  <p>
                    ModelScope（魔搭社区）是阿里云推出的模型开源社区，汇集了海量开源模型和数据集。
                  </p>
                  <p>
                    在模型市场中，你可以浏览魔搭社区上的热门模型，按下载量、喜欢数等排序，
                    并使用筛选器按任务、框架、标签等条件查找感兴趣的模型。
                  </p>
                  <p>
                    模型列表数据通过魔搭 OpenAPI 获取，无需登录即可浏览。
                    查看模型详情和文件列表需要配置访问令牌。
                  </p>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
