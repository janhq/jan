import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IconPlus, IconTrash, IconGripVertical } from '@tabler/icons-react'
import { MCPServerConfig } from '@/hooks/useMCPServers'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'

// Sortable argument item component
function SortableArgItem({
  id,
  value,
  onChange,
  onRemove,
  canRemove,
  placeholder,
}: {
  id: number
  value: string
  onChange: (value: string) => void
  onRemove: () => void
  canRemove: boolean
  placeholder: string
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 mb-2',
        isDragging ? 'z-10' : 'z-0'
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="size-6 cursor-move flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
      >
        <IconGripVertical size={18} className="text-main-view-fg/60" />
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1"
      />
      {canRemove && (
        <div
          className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
          onClick={onRemove}
        >
          <IconTrash size={18} className="text-destructive" />
        </div>
      )}
    </div>
  )
}

interface AddEditMCPServerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingKey: string | null
  initialData?: MCPServerConfig
  onSave: (name: string, config: MCPServerConfig) => void
}

export default function AddEditMCPServer({
  open,
  onOpenChange,
  editingKey,
  initialData,
  onSave,
}: AddEditMCPServerProps) {
  const { t } = useTranslation()
  const [serverName, setServerName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState<string[]>([''])
  const [envKeys, setEnvKeys] = useState<string[]>([''])
  const [envValues, setEnvValues] = useState<string[]>([''])

  // Reset form when modal opens/closes or editing key changes
  useEffect(() => {
    if (open && editingKey && initialData) {
      setServerName(editingKey)
      setCommand(initialData.command)
      setArgs(initialData.args?.length > 0 ? initialData.args : [''])

      if (initialData.env) {
        // Convert env object to arrays of keys and values
        const keys = Object.keys(initialData.env)
        const values = keys.map((key) => initialData.env[key])

        setEnvKeys(keys.length > 0 ? keys : [''])
        setEnvValues(values.length > 0 ? values : [''])
      }
    } else if (open) {
      // Add mode - reset form
      resetForm()
    }
  }, [open, editingKey, initialData])

  const resetForm = () => {
    setServerName('')
    setCommand('')
    setArgs([''])
    setEnvKeys([''])
    setEnvValues([''])
  }

  const handleAddArg = () => {
    setArgs([...args, ''])
  }

  const handleRemoveArg = (index: number) => {
    const newArgs = [...args]
    newArgs.splice(index, 1)
    setArgs(newArgs.length > 0 ? newArgs : [''])
  }

  const handleArgChange = (index: number, value: string) => {
    const newArgs = [...args]
    newArgs[index] = value
    setArgs(newArgs)
  }

  const handleReorderArgs = (oldIndex: number, newIndex: number) => {
    setArgs(arrayMove(args, oldIndex, newIndex))
  }

  // Sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 100,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  )

  const handleAddEnv = () => {
    setEnvKeys([...envKeys, ''])
    setEnvValues([...envValues, ''])
  }

  const handleRemoveEnv = (index: number) => {
    const newKeys = [...envKeys]
    const newValues = [...envValues]
    newKeys.splice(index, 1)
    newValues.splice(index, 1)
    setEnvKeys(newKeys.length > 0 ? newKeys : [''])
    setEnvValues(newValues.length > 0 ? newValues : [''])
  }

  const handleEnvKeyChange = (index: number, value: string) => {
    const newKeys = [...envKeys]
    newKeys[index] = value
    setEnvKeys(newKeys)
  }

  const handleEnvValueChange = (index: number, value: string) => {
    const newValues = [...envValues]
    newValues[index] = value
    setEnvValues(newValues)
  }

  const handleSave = () => {
    // Convert env arrays to object
    const envObj: Record<string, string> = {}
    envKeys.forEach((key, index) => {
      const keyName = key.trim()
      if (keyName !== '') {
        envObj[keyName] = envValues[index]?.trim() || ''
      }
    })

    // Filter out empty args
    const filteredArgs = args.map((arg) => arg.trim()).filter((arg) => arg)

    const config: MCPServerConfig = {
      command: command.trim(),
      args: filteredArgs,
      env: envObj,
    }

    if (serverName.trim() !== '') {
      onSave(serverName.trim(), config)
      onOpenChange(false)
      resetForm()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editingKey
              ? t('mcp-servers:editServer')
              : t('mcp-servers:addServer')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm mb-2 inline-block">
              {t('mcp-servers:serverName')}
            </label>
            <Input
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              placeholder={t('mcp-servers:enterServerName')}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm mb-2 inline-block">
              {t('mcp-servers:command')}
            </label>
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={t('mcp-servers:enterCommand')}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm">{t('mcp-servers:arguments')}</label>
              <div
                className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                onClick={handleAddArg}
              >
                <IconPlus size={18} className="text-main-view-fg/60" />
              </div>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(event) => {
                const { active, over } = event
                if (active.id !== over?.id) {
                  const oldIndex = parseInt(active.id.toString())
                  const newIndex = parseInt(over?.id.toString() || '0')
                  handleReorderArgs(oldIndex, newIndex)
                }
              }}
            >
              <SortableContext
                items={args.map((_, index) => index)}
                strategy={verticalListSortingStrategy}
              >
                {args.map((arg, index) => (
                  <SortableArgItem
                    key={index}
                    id={index}
                    value={arg}
                    onChange={(value) => handleArgChange(index, value)}
                    onRemove={() => handleRemoveArg(index)}
                    canRemove={args.length > 1}
                    placeholder={t('mcp-servers:argument', {
                      index: index + 1,
                    })}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm">{t('mcp-servers:envVars')}</label>
              <div
                className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                onClick={handleAddEnv}
              >
                <IconPlus size={18} className="text-main-view-fg/60" />
              </div>
            </div>

            {envKeys.map((key, index) => (
              <div key={`env-${index}`} className="flex items-center gap-2">
                <Input
                  value={key}
                  onChange={(e) => handleEnvKeyChange(index, e.target.value)}
                  placeholder={t('mcp-servers:key')}
                  className="flex-1"
                />
                <Input
                  value={envValues[index] || ''}
                  onChange={(e) => handleEnvValueChange(index, e.target.value)}
                  placeholder={t('mcp-servers:value')}
                  className="flex-1"
                />
                {envKeys.length > 1 && (
                  <div
                    className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                    onClick={() => handleRemoveEnv(index)}
                  >
                    <IconTrash size={18} className="text-destructive" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSave}>{t('mcp-servers:save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
