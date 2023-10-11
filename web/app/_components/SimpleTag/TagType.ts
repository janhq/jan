export enum ModelPerformance {
  PerformancePositive = "PerformancePositive",

  PerformanceNeutral = "PerformanceNeutral",

  PerformanceNegative = "PerformanceNegative",
}

export enum HardwareCompatibility {
  HardwareCompatible = "HardwareCompatible",

  HardwareIncompatible = "HardwareIncompatible",
}

export enum ExpectedPerformance {
  ExpectPerformanceMedium = "ExpectPerformanceMedium",
}

export enum ModelFormat {
  GGUF = "GGUF",
}

export enum FreestyleTag {
  FreeStyle = "FreeStyle",
}

export type TagType =
  | ModelPerformance
  | HardwareCompatibility
  | ExpectedPerformance
  | ModelFormat
  | FreestyleTag;
