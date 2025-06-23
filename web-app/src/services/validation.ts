import { invoke } from '@tauri-apps/api/core'

interface FolderValidationResult {
  is_valid_jan_folder: boolean
  is_empty: boolean
  has_important_data: boolean
  jan_specific_files: string[]
  folder_size_mb: number
  permissions_ok: boolean
  error_message?: string
  warnings: string[]
}

/**
 * Validates the current Jan data folder for factory reset operation
 * @returns Promise<FolderValidationResult> Validation result
 */
export const validateFactoryResetFolder = async (): Promise<FolderValidationResult> => {
  try {
    const result = await invoke<FolderValidationResult>('validate_factory_reset_folder')
    return result
  } catch (error) {
    console.error('Failed to validate factory reset folder:', error)
    throw new Error(`Validation failed: ${error}`)
  }
}

/**
 * Validates a target folder for data folder change operation
 * @param targetPath The path to validate
 * @returns Promise<FolderValidationResult> Validation result
 */
export const validateFolderChange = async (targetPath: string): Promise<FolderValidationResult> => {
  try {
    const result = await invoke<FolderValidationResult>('validate_folder_change', {
      targetPath,
    })
    return result
  } catch (error) {
    console.error('Failed to validate folder change:', error)
    throw new Error(`Validation failed: ${error}`)
  }
}

/**
 * Changes the app data folder with validation
 * @param newDataFolder The new data folder path
 * @param skipValidation Whether to skip validation (default: false)
 * @returns Promise<void>
 */
export const changeAppDataFolderWithValidation = async (
  newDataFolder: string,
  skipValidation: boolean = false
): Promise<void> => {
  try {
    await invoke('change_app_data_folder_with_validation', {
      newDataFolder,
      skipValidation,
    })
  } catch (error) {
    console.error('Failed to change app data folder:', error)
    throw new Error(`Failed to change data folder: ${error}`)
  }
}

/**
 * Creates a human-readable summary of validation results
 * @param result The validation result
 * @returns A formatted summary string
 */
export const createValidationSummary = (result: FolderValidationResult): string => {
  const lines: string[] = []
  
  if (result.error_message) {
    lines.push(`❌ Error: ${result.error_message}`)
    return lines.join('\n')
  }

  lines.push('📁 Folder Analysis:')
  lines.push(`   • Valid Jan folder: ${result.is_valid_jan_folder ? '✅ Yes' : '❌ No'}`)
  lines.push(`   • Empty: ${result.is_empty ? '✅ Yes' : '❌ No'}`)
  lines.push(`   • Contains important data: ${result.has_important_data ? '⚠️ Yes' : '✅ No'}`)
  lines.push(`   • Size: ${result.folder_size_mb.toFixed(1)} MB`)
  lines.push(`   • Permissions: ${result.permissions_ok ? '✅ OK' : '❌ Limited'}`)

  if (result.jan_specific_files.length > 0) {
    lines.push(`   • Jan files found: ${result.jan_specific_files.join(', ')}`)
  }

  if (result.warnings.length > 0) {
    lines.push('\n⚠️ Warnings:')
    result.warnings.forEach((warning: string) => {
      lines.push(`   • ${warning}`)
    })
  }

  return lines.join('\n')
}

/**
 * Determines if a validation result should block the operation
 * @param result The validation result
 * @returns true if the operation should be blocked
 */
export const shouldBlockOperation = (result: FolderValidationResult): boolean => {
  return !!result.error_message
}

/**
 * Determines if a validation result requires user confirmation
 * @param result The validation result
 * @returns true if user confirmation is required
 */
export const requiresConfirmation = (result: FolderValidationResult): boolean => {
  return result.warnings.length > 0 || result.has_important_data
}

/**
 * Gets the severity level of validation warnings
 * @param result The validation result
 * @returns 'error' | 'warning' | 'info'
 */
export const getValidationSeverity = (result: FolderValidationResult): 'error' | 'warning' | 'info' => {
  if (result.error_message) {
    return 'error'
  }
  
  if (result.has_important_data || result.warnings.some((w: string) => w.includes('important data'))) {
    return 'warning'
  }
  
  if (result.warnings.length > 0) {
    return 'warning'
  }
  
  return 'info'
}