/**
 * Represents the result of a Jan data folder validation
 */
export interface FolderValidationResult {
  /** Whether the folder is a valid Jan data folder */
  is_valid_jan_folder: boolean
  /** Whether the folder is empty */
  is_empty: boolean
  /** Whether the folder contains important data that would be lost */
  has_important_data: boolean
  /** List of Jan-specific files found in the folder */
  jan_specific_files: string[]
  /** Size of the folder in megabytes */
  folder_size_mb: number
  /** Whether the folder has proper read/write permissions */
  permissions_ok: boolean
  /** Error message if validation failed */
  error_message?: string
  /** List of warnings about the folder */
  warnings: string[]
}

/**
 * Validation options for folder operations
 */
export interface ValidationOptions {
  /** Skip validation checks (use with caution) */
  skip_validation?: boolean
  /** Force operation even with warnings */
  force?: boolean
}

/**
 * Factory reset validation options
 */
export interface FactoryResetValidation {
  /** The current data folder being validated */
  current_folder: string
  /** Validation result */
  validation: FolderValidationResult
  /** Whether user has confirmed the operation */
  confirmed: boolean
}

/**
 * Folder change validation options
 */
export interface FolderChangeValidation {
  /** The current data folder */
  current_folder: string
  /** The target folder for the change */
  target_folder: string
  /** Validation result for the target folder */
  validation: FolderValidationResult
  /** Whether user has confirmed the operation */
  confirmed: boolean
}