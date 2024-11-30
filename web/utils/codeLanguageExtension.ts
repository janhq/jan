// Utility function using switch-case for extension to language mapping
export function getLanguageFromExtension(extension: string): string {
  switch (extension.toLowerCase()) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'py':
      return 'python'
    case 'java':
      return 'java'
    case 'rb':
      return 'ruby'
    case 'cs':
      return 'csharp'
    case 'md':
      return 'markdown'
    case 'yaml':
    case 'yml':
      return 'yaml'
    case 'sh':
      return 'bash'
    case 'rs':
      return 'rust'
    case 'kt':
      return 'kotlin'
    case 'swift':
      return 'swift'
    default:
      return extension
  }
}
