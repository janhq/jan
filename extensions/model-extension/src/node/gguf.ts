import fs from 'fs-extra'

import type {
  ArchitectureType,
  BaseGGUFMetadata,
  BloomMetadata,
  FalconMetadata,
  GGUFMetadata,
  GPT2Metadata,
  GPTJMetadata,
  GPTNeoXMetadata,
  LlamaMetadata,
  MPTMetadata,
  RWKVMetadata,
} from './@types/gguf'
import {
  bloomMetadataSchema,
  falconMetadataSchema,
  gPT2MetadataSchema,
  gPTJMetadataSchema,
  gPTNeoXMetadataSchema,
  llamaMetadataSchema,
  mPTMetadataSchema,
  rWKVMetadataSchema,
} from './zodValidators'

type MetadataBaseValue = string | number | bigint | boolean
type MetadataArray = MetadataBaseValue[]
type MetadataValue = MetadataBaseValue | MetadataArray

type Version = 1 | 2 | 3
const isVersion = (version: number): version is Version =>
  version === 1 || version === 2 || version === 3

// type NumberBytes = { error: Error } | { error: null; value: number }
// type BigIntBytes = { error: Error } | { error: null; value: bigint }

type NumberBytes = any
type BigIntBytes = any

const ggufMagicNumber = Buffer.from([0x47, 0x47, 0x55, 0x46]).readInt32LE()

const readNBytes = async (
  fd: number,
  numBytes: number
): Promise<{ error: Error } | { bytes: Buffer; error?: undefined }> => {
  const buffer = Buffer.alloc(numBytes)
  const { bytesRead } = await fs.read(fd, buffer, 0, numBytes, null)
  if (bytesRead !== numBytes) {
    return { error: new Error('unexpected bytes read') }
  }
  return { bytes: buffer }
}

const readUint8 = async (fd: number): Promise<NumberBytes> => {
  const bytes = await readNBytes(fd, 1)
  if (bytes.error) return bytes
  return { error: null, value: bytes.bytes.readUInt8() }
}

const readUint16 = async (fd: number): Promise<NumberBytes> => {
  const bytes = await readNBytes(fd, 2)
  if (bytes.error) return bytes
  return { error: null, value: bytes.bytes.readUInt16LE() }
}

const readUint32 = async (fd: number): Promise<NumberBytes> => {
  const bytes = await readNBytes(fd, 4)
  if (bytes.error) return bytes
  return { error: null, value: bytes.bytes.readUInt32LE() }
}

const readUint64 = async (fd: number): Promise<BigIntBytes> => {
  const bytes = await readNBytes(fd, 8)
  if (bytes.error) return bytes
  return { error: null, value: bytes.bytes.readBigUInt64LE() }
}

const readInt8 = async (fd: number): Promise<NumberBytes> => {
  const bytes = await readNBytes(fd, 1)
  if (bytes.error) return bytes
  return { error: null, value: bytes.bytes.readInt8() }
}

const readInt16 = async (fd: number): Promise<NumberBytes> => {
  const bytes = await readNBytes(fd, 2)
  if (bytes.error) return bytes
  return { error: null, value: bytes.bytes.readInt16LE() }
}

const readInt32 = async (fd: number): Promise<NumberBytes> => {
  const bytes = await readNBytes(fd, 4)
  if (bytes.error) return bytes
  return { error: null, value: bytes.bytes.readInt32LE() }
}

const readInt64 = async (fd: number): Promise<BigIntBytes> => {
  const bytes = await readNBytes(fd, 8)
  if (bytes.error) return bytes
  return { error: null, value: bytes.bytes.readBigInt64LE() }
}

const readFloat32 = async (fd: number): Promise<NumberBytes> => {
  const bytes = await readNBytes(fd, 4)
  if (bytes.error) return bytes
  return { error: null, value: bytes.bytes.readFloatLE() }
}

const readFloat64 = async (fd: number): Promise<NumberBytes> => {
  const bytes = await readNBytes(fd, 8)
  if (bytes.error) return bytes
  const arrayBuffer = new ArrayBuffer(8)
  const view = new DataView(arrayBuffer)
  for (let i = 0; i < 8; ++i) {
    view.setUint8(i, bytes.bytes[i])
  }
  return { error: null, value: view.getFloat64(0) }
}

const readBool = async (
  fd: number
): Promise<{ error: Error } | { error: null; value: boolean }> => {
  const bytes = await readNBytes(fd, 1)
  if (bytes.error) return bytes
  return { error: null, value: !!bytes.bytes.readUint8() }
}

const readVersionedSize = async (
  fd: number,
  version: Version
): Promise<BigIntBytes> => {
  let value: bigint
  switch (version) {
    case 1: {
      const n = await readUint32(fd)
      if (n.error) return n
      value = BigInt(n.value)
      break
    }
    case 3:
    case 2: {
      const n = await readUint64(fd)
      if (n.error) return n
      value = n.value
      break
    }
  }
  return { error: null, value }
}

const readString = async (
  fd: number,
  version: Version
): Promise<{ error: Error } | { error: null; value: string }> => {
  const nBytes = await readVersionedSize(fd, version)
  if (nBytes.error) return nBytes
  const strBuffer = await readNBytes(fd, Number(nBytes.value)) // TODO: fix cast
  if (strBuffer.error) return strBuffer
  return {
    error: null,
    // eslint-disable-next-line no-control-regex
    value: strBuffer.bytes.toString().replace(/\x00/g, ''),
  }
}

const readArray = async (
  fd: number,
  version: Version
): Promise<{ error: Error } | { error: null; value: MetadataArray }> => {
  const arrType = await readUint32(fd)
  if (arrType.error) return arrType
  const numElts = await readVersionedSize(fd, version)
  if (numElts.error) return numElts
  const ret: MetadataArray = []
  for (let i = 0; i < numElts.value; ++i) {
    switch (arrType.value) {
      case 0: {
        const value = await readUint8(fd)
        if (value.error) return value
        ret.push(value.value)
        break
      }
      case 1: {
        const value = await readInt8(fd)
        if (value.error) return value
        ret.push(value.value)
        break
      }
      case 2: {
        const value = await readUint16(fd)
        if (value.error) return value
        ret.push(value.value)
        break
      }
      case 3: {
        const value = await readInt16(fd)
        if (value.error) return value
        ret.push(value.value)
        break
      }
      case 4: {
        const value = await readUint32(fd)
        if (value.error) return value
        ret.push(value.value)
        break
      }
      case 5: {
        const value = await readInt32(fd)
        if (value.error) return value
        ret.push(value.value)
        break
      }
      case 6: {
        const value = await readFloat32(fd)
        if (value.error) return value
        ret.push(value.value)
        break
      }
      case 7: {
        const value = await readBool(fd)
        if (value.error) return value
        ret.push(value.value)
        break
      }
      case 8: {
        const value = await readString(fd, version)
        if (value.error) return value
        ret.push(value.value)
        break
      }
      case 10: {
        const value = await readUint64(fd)
        if (value.error) return value
        ret.push(value.value)
        break
      }
      case 11: {
        const value = await readInt64(fd)
        if (value.error) return value
        ret.push(value.value)
        break
      }
      case 12: {
        const value = await readFloat64(fd)
        if (value.error) return value
        ret.push(value.value)
        break
      }
      default: {
        return { error: new Error('unknown metadata element key type') }
      }
    }
  }

  return { error: null, value: ret }
}

const isValidArchitecture = (
  architecture: string
): architecture is ArchitectureType => {
  return [
    'llama',
    'mpt',
    'gptneox',
    'gptj',
    'gpt2',
    'bloom',
    'falcon',
    'rwkv',
  ].includes(architecture)
}

const validateMetadata = (
  metadata: Record<string, any>
): { error: Error } | { error?: undefined; metadata: GGUFMetadata } => {
  if (metadata.error) return { error: metadata.error }
  const arch = metadata.general.architecture
  if (!arch) {
    throw new Error('general.architecture not found')
  }
  // we don't currently support any other architectures, but we could in the future
  // if you're reading this and want to add support for a new architecture,
  // make a PR :)
  if (!isValidArchitecture(arch)) {
    throw new Error(`invalid architecture: ${arch}`)
  }
  switch (arch) {
    case 'llama': {
      const res = llamaMetadataSchema.safeParse(metadata)
      if (res.success === false) return { error: res.error }
      return { metadata: res.data }
    }
    case 'mpt': {
      const res = mPTMetadataSchema.safeParse(metadata)
      if (res.success === false) return { error: res.error }
      return { metadata: res.data }
    }
    case 'gptneox': {
      const res = gPTNeoXMetadataSchema.safeParse(metadata)
      if (res.success === false) return { error: res.error }
      return { metadata: res.data }
    }
    case 'gptj': {
      const res = gPTJMetadataSchema.safeParse(metadata)
      if (res.success === false) return { error: res.error }
      return { metadata: res.data }
    }
    case 'gpt2': {
      const res = gPT2MetadataSchema.safeParse(metadata)
      if (res.success === false) return { error: res.error }
      return { metadata: res.data }
    }
    case 'bloom': {
      const res = bloomMetadataSchema.safeParse(metadata)
      if (res.success === false) return { error: res.error }
      return { metadata: res.data }
    }
    case 'falcon': {
      const res = falconMetadataSchema.safeParse(metadata)
      if (res.success === false) return { error: res.error }
      return { metadata: res.data }
    }
    case 'rwkv': {
      const res = rWKVMetadataSchema.safeParse(metadata)
      if (res.success === false) return { error: res.error }
      return { metadata: res.data }
    }
  }
}

const fileTypeIntToString = (
  fileType?: number
): BaseGGUFMetadata['file_type'] => {
  if (fileType == null) return undefined
  switch (fileType) {
    case 0:
      return 'ALL_F32'
    case 1:
      return 'MOSTLY_F16'
    case 2:
      return 'MOSTLY_Q4_0'
    case 3:
      return 'MOSTLY_Q4_1'
    case 4:
      return 'MOSTLY_Q4_1_SOME_F16'
    case 5:
      return 'MOSTLY_Q4_2'
    case 6:
      return 'MOSTLY_Q4_3'
    case 7:
      return 'MOSTLY_Q8_0'
    case 8:
      return 'MOSTLY_Q5_0'
    case 9:
      return 'MOSTLY_Q5_1'
    case 10:
      return 'MOSTLY_Q2_K'
    case 11:
      return 'MOSTLY_Q3_K_S'
    case 12:
      return 'MOSTLY_Q3_K_M'
    case 13:
      return 'MOSTLY_Q3_K_L'
    case 14:
      return 'MOSTLY_Q4_K_S'
    case 15:
      return 'MOSTLY_Q4_K_M'
    case 16:
      return 'MOSTLY_Q5_K_S'
    case 17:
      return 'MOSTLY_Q5_K_M'
    case 18:
      return 'MOSTLY_Q6_K'
    default:
      return undefined
  }
}

type ParsedMetadata =
  | { error: Error; metadata?: undefined }
  | { error?: undefined; metadata: GGUFMetadata }

const parseMetadata = async (filePath: string): Promise<ParsedMetadata> => {
  const metadata = await new Promise<
    { error: Error } | { error?: null; metadata: Record<string, any> }
  >((resolve) => {
    fs.open(filePath, 'r', async (error, fd) => {
      if (error) resolve({ error })

      const magic = await readUint32(fd)
      if (magic.error) return resolve(magic)
      if (magic.value !== ggufMagicNumber) {
        return resolve({ error: new Error('invalid gguf magic number') })
      }

      const version = await readUint32(fd)
      if (version.error) return resolve(version)
      if (!isVersion(version.value)) {
        return resolve({
          error: new Error(`unsupported gguf version: ${version.value}`),
        })
      }

      const tensorCount = await readVersionedSize(fd, version.value)
      if (tensorCount.error) return resolve(tensorCount)

      const numKv = await readVersionedSize(fd, version.value)
      if (numKv.error) return resolve(numKv)

      const metadata: Record<string, any> = {}

      const setKey = (keyName: string, value: MetadataValue) => {
        // this is a bad way to write this and should be clean it up
        // but since there are never more than 3 layers currently, it's fine for now
        const [key1, key2, key3, key4, key5] = keyName.split('.')

        if (!key2) {
          metadata[key1] = value
          return
        }
        if (!key3) {
          if (!metadata[key1]) metadata[key1] = {}
          metadata[key1][key2] = value
          return
        }
        if (!key4) {
          if (!metadata[key1]) metadata[key1] = {}
          if (!metadata[key1][key2]) metadata[key1][key2] = {}
          metadata[key1][key2][key3] = value
          return
        }
        if (!key5) {
          if (!metadata[key1]) metadata[key1] = {}
          if (!metadata[key1][key2]) metadata[key1][key2] = {}
          if (!metadata[key1][key2][key3]) metadata[key1][key2][key3] = {}
          metadata[key1][key2][key3][key4] = value
          return
        }
        if (!metadata[key1]) metadata[key1] = {}
        if (!metadata[key1][key2]) metadata[key1][key2] = {}
        if (!metadata[key1][key2][key3]) metadata[key1][key2][key3] = {}
        if (!metadata[key1][key2][key3][key4]) {
          metadata[key1][key2][key3][key4] = {}
        }
        metadata[key1][key2][key3][key4][key5] = value
      }

      for (let i = 0; i < numKv.value; ++i) {
        const key = await readString(fd, version.value)
        if (key.error) return resolve(key)
        const keyType = await readUint32(fd)
        if (keyType.error) return resolve(keyType)
        switch (keyType.value) {
          case 0: {
            const value = await readUint8(fd)
            if (value.error) return resolve(value)
            setKey(key.value, value.value)

            break
          }
          case 1: {
            const value = await readInt8(fd)
            if (value.error) return resolve(value)
            setKey(key.value, value.value)
            break
          }
          case 2: {
            const value = await readUint16(fd)
            if (value.error) return resolve(value)
            setKey(key.value, value.value)
            break
          }
          case 3: {
            const value = await readInt16(fd)
            if (value.error) return resolve(value)
            setKey(key.value, value.value)
            break
          }
          case 4: {
            const value = await readUint32(fd)
            if (value.error) return resolve(value)
            setKey(key.value, value.value)
            break
          }
          case 5: {
            const value = await readInt32(fd)
            if (value.error) return resolve(value)
            setKey(key.value, value.value)
            break
          }
          case 6: {
            const value = await readFloat32(fd)
            if (value.error) return resolve(value)
            setKey(key.value, value.value)
            break
          }
          case 7: {
            const value = await readBool(fd)
            if (value.error) return resolve(value)
            setKey(key.value, value.value)
            break
          }
          case 8: {
            const value = await readString(fd, version.value)
            if (value.error) return resolve(value)
            setKey(key.value, value.value)
            break
          }
          case 9: {
            const value = await readArray(fd, version.value)
            if (value.error) return resolve(value)
            setKey(key.value, value.value)
            break
          }
          case 10: {
            const value = await readUint64(fd)
            if (value.error) return resolve(value)
            setKey(key.value, value.value)
            break
          }
          case 11: {
            const value = await readInt64(fd)
            if (value.error) return resolve(value)
            setKey(key.value, value.value)
            break
          }
          case 12: {
            const value = await readFloat64(fd)
            if (value.error) return resolve(value)
            setKey(key.value, value.value)
            break
          }
          default: {
            return resolve({ error: new Error('unknown metadata key type') })
          }
        }
      }
      return resolve({ error: null, metadata })
    })
  })

  if (metadata.error) return { error: metadata.error }

  const validationError = validateMetadata({
    ...metadata.metadata,
    general: {
      ...metadata.metadata.general,
      file_type: fileTypeIntToString(metadata.metadata.general.file_type),
    },
  })
  if (validationError.error) return { error: validationError.error }

  return { metadata: validationError.metadata }
}

export default parseMetadata

export const isLlamaMetadata = (
  metadata: GGUFMetadata
): metadata is LlamaMetadata => {
  return metadata.general.architecture === 'llama'
}

export const isMPTMetadata = (
  metadata: GGUFMetadata
): metadata is MPTMetadata => {
  return metadata.general.architecture === 'mpt'
}

export const isGPTNeoXMetadata = (
  metadata: GGUFMetadata
): metadata is GPTNeoXMetadata => {
  return metadata.general.architecture === 'gptneox'
}

export const isGPTJMetadata = (
  metadata: GGUFMetadata
): metadata is GPTJMetadata => {
  return metadata.general.architecture === 'gptj'
}

export const isGPT2Metadata = (
  metadata: GGUFMetadata
): metadata is GPT2Metadata => {
  return metadata.general.architecture === 'gpt2'
}

export const isBloomMetadata = (
  metadata: GGUFMetadata
): metadata is BloomMetadata => {
  return metadata.general.architecture === 'bloom'
}

export const isFalconMetadata = (
  metadata: GGUFMetadata
): metadata is FalconMetadata => {
  return metadata.general.architecture === 'falcon'
}

export const isRWKVMetadata = (
  metadata: GGUFMetadata
): metadata is RWKVMetadata => {
  return metadata.general.architecture === 'rwkv'
}
