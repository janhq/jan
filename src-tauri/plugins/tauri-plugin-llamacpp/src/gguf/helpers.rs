use byteorder::{LittleEndian, ReadBytesExt};
use std::convert::TryFrom;
use std::io::{self, BufReader, Read, Seek};

use super::types::{GgufMetadata, GgufValueType};

pub fn read_gguf_metadata<R: Read + Seek>(reader: R) -> io::Result<GgufMetadata> {
    let mut file = BufReader::new(reader);

    let mut magic = [0u8; 4];
    file.read_exact(&mut magic)?;
    if &magic != b"GGUF" {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Not a GGUF file",
        ));
    }

    let version = file.read_u32::<LittleEndian>()?;
    let tensor_count = file.read_u64::<LittleEndian>()?;
    let metadata_count = file.read_u64::<LittleEndian>()?;

    let mut metadata_map = std::collections::HashMap::new();
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

fn read_metadata_entry<R: Read + Seek>(reader: &mut R, index: u64) -> io::Result<(String, String)>
where
    R: ReadBytesExt,
{
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

fn read_gguf_string<R: Read>(reader: &mut R) -> io::Result<String>
where
    R: ReadBytesExt,
{
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

fn read_gguf_value<R: Read + Seek>(reader: &mut R, value_type: GgufValueType) -> io::Result<String>
where
    R: ReadBytesExt,
{
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
) -> io::Result<()>
where
    R: ReadBytesExt,
{
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
