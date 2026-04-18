/**
 * ModelScope API types (matching Rust models)
 */

export interface ModelScopeModel {
  id: string
  display_name?: string | null
  description?: string | null
  downloads: number
  likes: number
  license?: string | null
  tasks?: string[] | null
  created_at: string
  last_modified: string
  file_size: number
  params: number
  tags?: string[] | null
  private: boolean
  gated: boolean
}

export interface ModelScopeModelsResult {
  models: ModelScopeModel[]
  total_count: number
  page_number: number
  page_size: number
}

export interface ModelScopeModelDetail extends ModelScopeModel {
  readme?: string | null
}

export interface ModelScopeDetailResult {
  model: ModelScopeModelDetail
}

export type ModelScopeSort = 'downloads' | 'likes' | 'last_modified' | 'default'

export interface ListModelScopeModelsParams {
  search?: string
  owner?: string
  sort?: ModelScopeSort
  page_number?: number
  page_size?: number
  filter_task?: string
  filter_library?: string
  filter_model_type?: string
  filter_custom_tag?: string
  filter_license?: string
  filter_deploy?: string
}

// Filter options for UI
export const MODELSCOPE_SORT_OPTIONS = [
  { value: 'downloads', label: '最多下载' },
  { value: 'likes', label: '最多喜欢' },
  { value: 'last_modified', label: '最近更新' },
  { value: 'default', label: '默认排序' },
] as const

export const MODELSCOPE_TASK_OPTIONS = [
  { value: 'text-generation', label: '文本生成' },
  { value: 'text-to-image-synthesis', label: '文生图' },
  { value: 'image-captioning', label: '图像描述' },
  { value: 'text-classification', label: '文本分类' },
  { value: 'voice-activity-detection', label: '语音检测' },
  { value: 'automatic-speech-recognition', label: '语音识别' },
  { value: 'text-to-speech', label: '语音合成' },
  { value: 'translation', label: '翻译' },
  { value: 'question-answering', label: '问答' },
  { value: 'fill-mask', label: '掩码填充' },
  { value: 'feature-extraction', label: '特征提取' },
  { value: 'sentence-similarity', label: '句子相似度' },
  { value: 'image-classification', label: '图像分类' },
  { value: 'object-detection', label: '目标检测' },
  { value: 'semantic-segmentation', label: '语义分割' },
] as const

export const MODELSCOPE_LIBRARY_OPTIONS = [
  { value: 'pytorch', label: 'PyTorch' },
  { value: 'safetensors', label: 'Safetensors' },
  { value: 'diffusers', label: 'Diffusers' },
  { value: 'transformer', label: 'Transformers' },
  { value: 'gguf', label: 'GGUF' },
] as const
