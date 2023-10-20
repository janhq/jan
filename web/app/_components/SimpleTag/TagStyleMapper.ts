import { TagType } from './TagType'

export const tagStyleMapper: Record<TagType, string> = {
  GGUF: 'bg-yellow-100 text-yellow-800',
  PerformancePositive:
    'text-green-700 ring-1 ring-inset ring-green-600/20 bg-green-50',
  PerformanceNeutral:
    'bg-yellow-50 text-yellow-800 ring-1 ring-inset ring-yellow-600/20',
  PerformanceNegative:
    'bg-red-50 ext-red-700 ring-1 ring-inset ring-red-600/10',
  HardwareCompatible: 'bg-red-50 ext-red-700 ring-1 ring-inset ring-red-600/10',
  HardwareIncompatible:
    'bg-red-50 ext-red-700 ring-1 ring-inset ring-red-600/10',
  FreeStyle: 'bg-gray-100 text-gray-800',
  ExpectPerformanceMedium: 'bg-yellow-100 text-yellow-800',
  Version: 'bg-red-100 text-yellow-800',
  Default: 'bg-blue-100 text-blue-800',
  RamDefault: 'bg-green-50 text-green-700',
  UsecaseDefault: 'bg-orange-100 text-yellow-800',
  MiscellanousDefault: 'bg-blue-100 text-blue-800',
}
