export type SelectFileOption = {
  /**
   * The title of the dialog.
   */
  title?: string
  /**
   * Whether the dialog allows multiple selection.
   */
  allowMultiple?: boolean

  buttonLabel?: string

  selectDirectory?: boolean

  props?: SelectFileProp[]
}

export const SelectFilePropTuple = [
  'openFile',
  'openDirectory',
  'multiSelections',
  'showHiddenFiles',
  'createDirectory',
  'promptToCreate',
  'noResolveAliases',
  'treatPackageAsDirectory',
  'dontAddToRecent',
] as const

export type SelectFileProp = (typeof SelectFilePropTuple)[number]
