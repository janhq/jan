export interface HuggingFaceRepoData {
  id: string
  tags: Array<'transformers' | 'pytorch' | 'safetensors' | string>
  siblings: {
    rfilename: string
  }[]
  createdAt: string // ISO 8601 timestamp
}
