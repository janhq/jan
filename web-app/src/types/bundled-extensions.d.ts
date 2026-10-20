type BundledExtensionCtor = new (
  url: string,
  name: string,
  productName?: string,
  active?: boolean,
  description?: string,
  version?: string
) => import('@janhq/core').BaseExtension

declare module '@janhq/assistant-extension' {
  const ext: BundledExtensionCtor
  export default ext
}
declare module '@janhq/download-extension' {
  const ext: BundledExtensionCtor
  export default ext
}
declare module '@janhq/llamacpp-extension' {
  const ext: BundledExtensionCtor
  export default ext
}
declare module '@janhq/mlx-extension' {
  const ext: BundledExtensionCtor
  export default ext
}
declare module '@janhq/rag-extension' {
  const ext: BundledExtensionCtor
  export default ext
}
declare module '@janhq/vector-db-extension' {
  const ext: BundledExtensionCtor
  export default ext
}
declare module '@janhq/conversational-extension' {
  const ext: BundledExtensionCtor
  export default ext
}
