type BundledExtensionCtor = new (
  url: string,
  name: string,
  productName?: string,
  active?: boolean,
  description?: string,
  version?: string
) => import('@janhq/core').BaseExtension

declare module '@janhq/assistant-extension' {
  export function activate(
    ctx: import('@janhq/core').InternalExtensionContext
  ): Promise<void>
}
declare module '@janhq/download-extension' {
  export function activate(
    ctx: import('@janhq/core').InternalExtensionContext
  ): Promise<void>
}
declare module '@janhq/llamacpp-extension' {
  export function activate(
    ctx: import('@janhq/core').InternalExtensionContext
  ): Promise<void>
}
declare module '@janhq/mlx-extension' {
  export function activate(
    ctx: import('@janhq/core').InternalExtensionContext
  ): Promise<void>
}
declare module '@janhq/rag-extension' {
  const ext: BundledExtensionCtor
  export default ext
}
declare module '@janhq/vector-db-extension' {
  const ext: BundledExtensionCtor
  export default ext
}
