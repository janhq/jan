export enum ModelPerformance {
  PerformancePositive = 'PerformancePositive',

  PerformanceNeutral = 'PerformanceNeutral',

  PerformanceNegative = 'PerformanceNegative',
}

export enum HardwareCompatibility {
  HardwareCompatible = 'HardwareCompatible',

  HardwareIncompatible = 'HardwareIncompatible',
}

export enum ExpectedPerformance {
  ExpectPerformanceMedium = 'ExpectPerformanceMedium',
}

export enum ModelFormat {
  GGUF = 'GGUF',
}

export enum FreestyleTag {
  FreeStyle = 'FreeStyle',
}

export enum VersionTag {
  Version = 'Version',
}

export enum QuantMethodTag {
  Default = 'Default',
}

export enum NumOfBit {
  Default = 'Default',
}

export enum RamRequired {
  RamDefault = 'RamDefault',
}

export enum UsecaseTag {
  UsecaseDefault = 'UsecaseDefault',
}

export enum MiscellanousTag {
  MiscellanousDefault = 'MiscellanousDefault',
}

export type TagType =
  | ModelPerformance
  | HardwareCompatibility
  | ExpectedPerformance
  | ModelFormat
  | FreestyleTag
  | VersionTag
  | QuantMethodTag
  | NumOfBit
  | RamRequired
  | UsecaseTag
  | MiscellanousTag
