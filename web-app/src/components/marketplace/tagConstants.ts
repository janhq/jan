import {
  IconMessage,
  IconPhoto,
  IconMicrophone,
  IconVolume,
  IconEye,
  IconLanguage,
  IconBrain,
} from '@tabler/icons-react'
import type { ModelScopeModel } from '@/services/modelscope/types'

export interface TagItem {
  type: 'task' | 'library' | 'license' | 'params'
  value: string
  abbr: string
  label: string
  tooltip: string
  colorClass: string
  icon?: React.ComponentType<{ size?: number; className?: string }>
}

/* ------------------------------------------------------------------ */
/* 1. 任务类型                                                         */
/* ------------------------------------------------------------------ */
const taskConfigs: Record<string, Omit<TagItem, 'type' | 'value' | 'tooltip'>> = {
  'text-generation': {
    abbr: '文本',
    label: '文本生成',
    colorClass:
      'bg-blue-500/20 text-blue-600 border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-400',
    icon: IconMessage,
  },
  'text-to-image-synthesis': {
    abbr: '生图',
    label: '文生图',
    colorClass:
      'bg-purple-500/20 text-purple-600 border-purple-500/30 dark:bg-purple-500/20 dark:text-purple-400',
    icon: IconPhoto,
  },
  'automatic-speech-recognition': {
    abbr: '语音',
    label: '语音识别',
    colorClass:
      'bg-emerald-500/20 text-emerald-600 border-emerald-500/30 dark:bg-emerald-500/20 dark:text-emerald-400',
    icon: IconMicrophone,
  },
  'text-to-speech': {
    abbr: '合成',
    label: '语音合成',
    colorClass:
      'bg-teal-500/20 text-teal-600 border-teal-500/30 dark:bg-teal-500/20 dark:text-teal-400',
    icon: IconVolume,
  },
  'image-classification': {
    abbr: '分类',
    label: '图像分类',
    colorClass:
      'bg-amber-500/20 text-amber-600 border-amber-500/30 dark:bg-amber-500/20 dark:text-amber-400',
    icon: IconEye,
  },
  'translation': {
    abbr: '翻译',
    label: '翻译',
    colorClass:
      'bg-indigo-500/20 text-indigo-600 border-indigo-500/30 dark:bg-indigo-500/20 dark:text-indigo-400',
    icon: IconLanguage,
  },
}

const defaultTaskConfig: Omit<TagItem, 'type' | 'value' | 'tooltip'> = {
  abbr: 'AI',
  label: 'AI',
  colorClass: 'bg-muted text-muted-foreground border-border',
  icon: IconBrain,
}

/* ------------------------------------------------------------------ */
/* 2. 框架                                                             */
/* ------------------------------------------------------------------ */
const frameworkConfigs: Record<
  string,
  Omit<TagItem, 'type' | 'value' | 'tooltip'>
> = {
  gguf: {
    abbr: 'GG',
    label: 'GGUF',
    colorClass:
      'bg-orange-500/20 text-orange-600 border-orange-500/30 dark:bg-orange-500/20 dark:text-orange-400',
  },
  pytorch: {
    abbr: 'PY',
    label: 'PyTorch',
    colorClass:
      'bg-red-500/20 text-red-600 border-red-500/30 dark:bg-red-500/20 dark:text-red-400',
  },
  safetensors: {
    abbr: 'ST',
    label: 'Safetensors',
    colorClass:
      'bg-cyan-500/20 text-cyan-600 border-cyan-500/30 dark:bg-cyan-500/20 dark:text-cyan-400',
  },
  diffusers: {
    abbr: 'DF',
    label: 'Diffusers',
    colorClass:
      'bg-pink-500/20 text-pink-600 border-pink-500/30 dark:bg-pink-500/20 dark:text-pink-400',
  },
  transformer: {
    abbr: 'TF',
    label: 'Transformers',
    colorClass:
      'bg-sky-500/20 text-sky-600 border-sky-500/30 dark:bg-sky-500/20 dark:text-sky-400',
  },
}

/* ------------------------------------------------------------------ */
/* 3. 许可证                                                           */
/* ------------------------------------------------------------------ */
const licenseConfigs: Record<string, Omit<TagItem, 'type' | 'value' | 'tooltip'>> = {
  'apache-2.0': {
    abbr: 'OS',
    label: 'Apache 2.0',
    colorClass:
      'bg-green-500/20 text-green-600 border-green-500/30 dark:bg-green-500/20 dark:text-green-400',
  },
  mit: {
    abbr: 'OS',
    label: 'MIT',
    colorClass:
      'bg-green-500/20 text-green-600 border-green-500/30 dark:bg-green-500/20 dark:text-green-400',
  },
  bsd: {
    abbr: 'OS',
    label: 'BSD',
    colorClass:
      'bg-green-500/20 text-green-600 border-green-500/30 dark:bg-green-500/20 dark:text-green-400',
  },
  'llama-3': {
    abbr: 'CL',
    label: 'Llama 3 License',
    colorClass:
      'bg-yellow-500/20 text-yellow-600 border-yellow-500/30 dark:bg-yellow-500/20 dark:text-yellow-400',
  },
  qwen: {
    abbr: 'CL',
    label: 'Qwen License',
    colorClass:
      'bg-yellow-500/20 text-yellow-600 border-yellow-500/30 dark:bg-yellow-500/20 dark:text-yellow-400',
  },
}

/* ------------------------------------------------------------------ */
/* 4. 参数规模                                                         */
/* ------------------------------------------------------------------ */
function getParamsConfig(
  params: number
): Omit<TagItem, 'type' | 'value' | 'tooltip'> | null {
  if (params < 3) {
    return {
      abbr: 'S',
      label: '< 3B',
      colorClass:
        'bg-slate-400/20 text-slate-500 border-slate-400/30 dark:bg-slate-400/20 dark:text-slate-400',
    }
  } else if (params <= 15) {
    return {
      abbr: 'M',
      label: '3B - 15B',
      colorClass:
        'bg-slate-500/20 text-slate-600 border-slate-500/30 dark:bg-slate-500/20 dark:text-slate-400',
    }
  } else if (params <= 50) {
    return {
      abbr: 'L',
      label: '15B - 50B',
      colorClass:
        'bg-slate-600/20 text-slate-700 border-slate-600/30 dark:bg-slate-600/20 dark:text-slate-400',
    }
  } else {
    return {
      abbr: 'XL',
      label: '> 50B',
      colorClass:
        'bg-slate-700/20 text-slate-800 border-slate-700/30 dark:bg-slate-700/20 dark:text-slate-400',
    }
  }
}

/* ------------------------------------------------------------------ */
/* 组装函数                                                            */
/* ------------------------------------------------------------------ */
export function getModelTags(model: ModelScopeModel): TagItem[] {
  const tags: TagItem[] = []

  // 1. 任务类型
  const task = model.tasks?.[0]
  if (task) {
    const config = taskConfigs[task] ?? defaultTaskConfig
    tags.push({
      type: 'task',
      value: task,
      ...config,
      tooltip: `${config.label} · 点击筛选所有${config.label}模型`,
    })
  }

  // 2. 框架
  const tagStrs = (model.tags ?? []).map((t) => t.toLowerCase())
  const modelIdLower = model.id.toLowerCase()
  const fwEntry = Object.entries(frameworkConfigs).find(
    ([key]) =>
      tagStrs.some((t) => t.includes(key)) || modelIdLower.includes(key)
  )
  if (fwEntry) {
    const [value, config] = fwEntry
    tags.push({
      type: 'library',
      value,
      ...config,
      tooltip: `${config.label} 格式 · 点击筛选 ${config.label} 模型`,
    })
  }

  // 3. 许可证
  const licenseLower = (model.license ?? '').toLowerCase()
  const licenseEntry = Object.entries(licenseConfigs).find(([key]) =>
    licenseLower.includes(key)
  )
  if (licenseEntry) {
    const [value, config] = licenseEntry
    tags.push({
      type: 'license',
      value,
      ...config,
      tooltip: `${config.label} · 点击筛选 ${config.label} 许可证模型`,
    })
  }

  // 4. 参数规模
  const paramsConfig = getParamsConfig(model.params)
  if (paramsConfig) {
    tags.push({
      type: 'params',
      value: String(model.params),
      ...paramsConfig,
      tooltip: `参数规模 ${paramsConfig.label} · 点击筛选`,
    })
  }

  return tags
}
