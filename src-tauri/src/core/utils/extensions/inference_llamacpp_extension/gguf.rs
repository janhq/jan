use byteorder::{LittleEndian, ReadBytesExt};
use serde::Serialize;
use std::{
    collections::HashMap,
    convert::TryFrom,
    fs::File,
    io::{self, Read, Seek, BufReader},
    path::Path,
};

#[derive(Debug, Clone, Copy)]
#[repr(u32)]
enum GgufValueType {
    Uint8 = 0,
    Int8 = 1,
    Uint16 = 2,
    Int16 = 3,
    Uint32 = 4,
    Int32 = 5,
    Float32 = 6,
    Bool = 7,
    String = 8,
    Array = 9,
    Uint64 = 10,
    Int64 = 11,
    Float64 = 12,
}

impl TryFrom<u32> for GgufValueType {
    type Error = io::Error;
    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Uint8),
            1 => Ok(Self::Int8),
            2 => Ok(Self::Uint16),
            3 => Ok(Self::Int16),
            4 => Ok(Self::Uint32),
            5 => Ok(Self::Int32),
            6 => Ok(Self::Float32),
            7 => Ok(Self::Bool),
            8 => Ok(Self::String),
            9 => Ok(Self::Array),
            10 => Ok(Self::Uint64),
            11 => Ok(Self::Int64),
            12 => Ok(Self::Float64),
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Unknown GGUF value type: {}", value),
            )),
        }
    }
}

#[derive(Serialize)]
pub struct GgufMetadata {
    version: u32,
    tensor_count: u64,
    metadata: HashMap<String, String>,
}

fn read_gguf_metadata_internal<P: AsRef<Path>>(path: P) -> io::Result<GgufMetadata> {
    let mut file = BufReader::new(File::open(path)?);

    let mut magic = [0u8; 4];
    file.read_exact(&mut magic)?;
    if &magic != b"GGUF" {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "Not a GGUF file"));
    }

    let version = file.read_u32::<LittleEndian>()?;
    let tensor_count = file.read_u64::<LittleEndian>()?;
    let metadata_count = file.read_u64::<LittleEndian>()?;

    let mut metadata_map = HashMap::new();
    for i in 0..metadata_count {
        match read_metadata_entry(&mut file, i) {
            Ok((key, value)) => {
                metadata_map.insert(key, value);
            }
            Err(e) => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("Error reading metadata entry {}: {}", i, e),
                ));
            }
        }
    }

    Ok(GgufMetadata {
        version,
        tensor_count,
        metadata: metadata_map,
    })
}

fn read_metadata_entry<R: Read + Seek>(reader: &mut R, index: u64) -> io::Result<(String, String)> {
    let key = read_gguf_string(reader).map_err(|e| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Failed to read key for metadata entry {}: {}", index, e),
        )
    })?;

    let value_type_u32 = reader.read_u32::<LittleEndian>()?;
    let value_type = GgufValueType::try_from(value_type_u32)?;
    let value = read_gguf_value(reader, value_type)?;

    Ok((key, value))
}

fn read_gguf_string<R: Read>(reader: &mut R) -> io::Result<String> {
    let len = reader.read_u64::<LittleEndian>()?;
    if len > (1024 * 1024) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("String length {} is unreasonably large", len),
        ));
    }
    let mut buf = vec![0u8; len as usize];
    reader.read_exact(&mut buf)?;
    Ok(String::from_utf8(buf).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?)
}

fn read_gguf_value<R: Read + Seek>(
    reader: &mut R,
    value_type: GgufValueType,
) -> io::Result<String> {
    match value_type {
        GgufValueType::Uint8 => Ok(reader.read_u8()?.to_string()),
        GgufValueType::Int8 => Ok(reader.read_i8()?.to_string()),
        GgufValueType::Uint16 => Ok(reader.read_u16::<LittleEndian>()?.to_string()),
        GgufValueType::Int16 => Ok(reader.read_i16::<LittleEndian>()?.to_string()),
        GgufValueType::Uint32 => Ok(reader.read_u32::<LittleEndian>()?.to_string()),
        GgufValueType::Int32 => Ok(reader.read_i32::<LittleEndian>()?.to_string()),
        GgufValueType::Float32 => Ok(reader.read_f32::<LittleEndian>()?.to_string()),
        GgufValueType::Bool => Ok((reader.read_u8()? != 0).to_string()),
        GgufValueType::String => read_gguf_string(reader),
        GgufValueType::Uint64 => Ok(reader.read_u64::<LittleEndian>()?.to_string()),
        GgufValueType::Int64 => Ok(reader.read_i64::<LittleEndian>()?.to_string()),
        GgufValueType::Float64 => Ok(reader.read_f64::<LittleEndian>()?.to_string()),
        GgufValueType::Array => {
            let elem_type_u32 = reader.read_u32::<LittleEndian>()?;
            let elem_type = GgufValueType::try_from(elem_type_u32)?;
            let len = reader.read_u64::<LittleEndian>()?;

            if len > 1_000_000 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("Array length {} is unreasonably large", len),
                ));
            }

            if len > 24 {
                skip_array_data(reader, elem_type, len)?;
                return Ok(format!(
                    "<Array of type {:?} with {} elements, data skipped>",
                    elem_type, len
                ));
            }

            let mut elems = Vec::with_capacity(len as usize);
            for _ in 0..len {
                elems.push(read_gguf_value(reader, elem_type)?);
            }
            Ok(format!("[{}]", elems.join(", ")))
        }
    }
}

fn skip_array_data<R: Read + Seek>(
    reader: &mut R,
    elem_type: GgufValueType,
    len: u64,
) -> io::Result<()> {
    match elem_type {
        GgufValueType::Uint8 | GgufValueType::Int8 | GgufValueType::Bool => {
            reader.seek(io::SeekFrom::Current(len as i64))?;
        }
        GgufValueType::Uint16 | GgufValueType::Int16 => {
            reader.seek(io::SeekFrom::Current((len * 2) as i64))?;
        }
        GgufValueType::Uint32 | GgufValueType::Int32 | GgufValueType::Float32 => {
            reader.seek(io::SeekFrom::Current((len * 4) as i64))?;
        }
        GgufValueType::Uint64 | GgufValueType::Int64 | GgufValueType::Float64 => {
            reader.seek(io::SeekFrom::Current((len * 8) as i64))?;
        }
        GgufValueType::String => {
            for _ in 0..len {
                let str_len = reader.read_u64::<LittleEndian>()?;
                reader.seek(io::SeekFrom::Current(str_len as i64))?;
            }
        }
        GgufValueType::Array => {
            for _ in 0..len {
                read_gguf_value(reader, elem_type)?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn read_gguf_metadata(path: String) -> Result<GgufMetadata, String> {
    // run the blocking code in a separate thread pool
    tauri::async_runtime::spawn_blocking(move || {
        read_gguf_metadata_internal(path)
            .map_err(|e| e.to_string())
    })
    .await
    .unwrap()
}

