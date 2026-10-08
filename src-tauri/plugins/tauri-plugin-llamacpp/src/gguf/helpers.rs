use byteorder::{LittleEndian, ReadBytesExt};
use std::convert::TryFrom;
use std::io::{self, BufReader, Read, Seek};

use super::types::{GgufMetadata, GgufValueType};

/// GGML_MAX_DIMS. A larger rank means the walk has desynchronised, not that a
/// new tensor shape exists.
const MAX_TENSOR_DIMS: u32 = 4;

/// Bound on the tensor-info loop, so a corrupt count cannot spin. The largest
/// real models are in the low thousands.
const MAX_TENSORS: u64 = 1_000_000;

pub fn read_gguf_metadata<R: Read + Seek>(reader: R) -> io::Result<GgufMetadata> {
    let mut file = BufReader::new(reader);
    read_header(&mut file)
}

/// Which of `wanted` appear in the tensor-info block.
///
/// Exact names, mirroring llama.cpp's own `gguf_find_tensor`, because that is
/// how the interesting facts are phrased: a DSpark draft is a DFlash one plus
/// `markov_w1.weight`, and upstream detects an MTP head by
/// `blk.<block_count-1>.nextn.eh_proj.weight`. Returning every name instead
/// would put hundreds of kilobytes of strings through the IPC boundary on
/// every import to answer a yes/no question.
///
/// Only the first split of a sharded model is read, so a tensor living in a
/// later shard is reported absent -- the same limit upstream's
/// `common_speculative_types_from_gguf` documents.
pub fn find_gguf_tensors<R: Read + Seek>(
    reader: R,
    wanted: &[String],
) -> io::Result<Vec<String>> {
    let mut file = BufReader::new(reader);
    let meta = read_header(&mut file)?;

    if wanted.is_empty() {
        return Ok(Vec::new());
    }
    // v1 sized strings and dimensions with u32s. llama.cpp refuses that
    // version outright, and reading it as v2 would invent names.
    if meta.version < 2 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("GGUF version {} has no readable tensor block", meta.version),
        ));
    }
    if meta.tensor_count > MAX_TENSORS {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("tensor count {} is unreasonably large", meta.tensor_count),
        ));
    }

    let mut found: Vec<String> = Vec::new();
    for i in 0..meta.tensor_count {
        let name = read_gguf_string(&mut file).map_err(|e| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Failed to read name for tensor {}: {}", i, e),
            )
        })?;
        let n_dims = file.read_u32::<LittleEndian>()?;
        if n_dims > MAX_TENSOR_DIMS {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("tensor {} claims {} dimensions", i, n_dims),
            ));
        }
        // Read rather than seek: BufReader drops its buffer on every seek, so
        // skipping this way costs a syscall per tensor on a large model.
        for _ in 0..n_dims {
            file.read_u64::<LittleEndian>()?;
        }
        file.read_u32::<LittleEndian>()?; // ggml type
        file.read_u64::<LittleEndian>()?; // offset into the data section

        if wanted.contains(&name) && !found.contains(&name) {
            found.push(name);
            if found.len() == wanted.len() {
                break;
            }
        }
    }
    Ok(found)
}

/// Header plus the whole KV section, leaving the reader positioned at the
/// start of the tensor-info block.
fn read_header<R: Read + Seek>(file: &mut BufReader<R>) -> io::Result<GgufMetadata> {
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
        match read_metadata_entry(file, i) {
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

fn read_metadata_entry<R: Read + Seek + ReadBytesExt>(
    reader: &mut R,
    index: u64,
) -> io::Result<(String, String)> {
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

fn read_gguf_string<R: Read + ReadBytesExt>(reader: &mut R) -> io::Result<String> {
    let len = reader.read_u64::<LittleEndian>()?;
    if len > (1024 * 1024) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("String length {} is unreasonably large", len),
        ));
    }
    let mut buf = vec![0u8; len as usize];
    reader.read_exact(&mut buf)?;
    String::from_utf8(buf).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

fn read_gguf_value<R: Read + Seek + ReadBytesExt>(
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

fn skip_array_data<R: Read + Seek + ReadBytesExt>(
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

#[cfg(test)]
mod tests {
    use super::*;
    use byteorder::WriteBytesExt;
    use std::io::Cursor;

    /// Builds a GGUF header with the given KV entries and tensor-info block.
    /// Hand-assembled because the point is to pin the byte layout the reader
    /// walks; a fixture file would hide it.
    fn gguf(version: u32, kv: &[(&str, &str)], tensors: &[(&str, &[u64])]) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(b"GGUF");
        b.write_u32::<LittleEndian>(version).unwrap();
        b.write_u64::<LittleEndian>(tensors.len() as u64).unwrap();
        b.write_u64::<LittleEndian>(kv.len() as u64).unwrap();

        let string = |b: &mut Vec<u8>, s: &str| {
            b.write_u64::<LittleEndian>(s.len() as u64).unwrap();
            b.extend_from_slice(s.as_bytes());
        };
        for (k, v) in kv {
            string(&mut b, k);
            b.write_u32::<LittleEndian>(GgufValueType::String as u32).unwrap();
            string(&mut b, v);
        }
        for (name, dims) in tensors {
            string(&mut b, name);
            b.write_u32::<LittleEndian>(dims.len() as u32).unwrap();
            for d in *dims {
                b.write_u64::<LittleEndian>(*d).unwrap();
            }
            b.write_u32::<LittleEndian>(0).unwrap(); // ggml type
            b.write_u64::<LittleEndian>(0).unwrap(); // offset
        }
        b
    }

    fn want(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn metadata_still_reads_with_a_tensor_block_present() {
        let bytes = gguf(3, &[("general.architecture", "dflash")], &[("markov_w1.weight", &[4, 8])]);
        let meta = read_gguf_metadata(Cursor::new(bytes)).expect("metadata");
        assert_eq!(meta.version, 3);
        assert_eq!(meta.tensor_count, 1);
        assert_eq!(
            meta.metadata.get("general.architecture").map(String::as_str),
            Some("dflash")
        );
    }

    // The Markov head is the only thing separating a DSpark draft from a
    // DFlash one, and it is a tensor, not a metadata key.
    #[test]
    fn finds_a_requested_tensor_among_others() {
        let bytes = gguf(
            3,
            &[("general.architecture", "dflash")],
            &[
                ("token_embd.weight", &[4096, 128]),
                ("markov_w1.weight", &[4, 8]),
                ("markov_w2.weight", &[4, 8]),
            ],
        );
        let found = find_gguf_tensors(Cursor::new(bytes), &want(&["markov_w1.weight"]))
            .expect("tensor scan");
        assert_eq!(found, want(&["markov_w1.weight"]));
    }

    #[test]
    fn reports_nothing_when_the_tensor_is_absent() {
        let bytes = gguf(3, &[], &[("token_embd.weight", &[4096, 128])]);
        let found = find_gguf_tensors(Cursor::new(bytes), &want(&["markov_w1.weight"]))
            .expect("tensor scan");
        assert!(found.is_empty(), "{found:?}");
    }

    #[test]
    fn finds_several_and_ignores_the_rest() {
        let bytes = gguf(
            3,
            &[],
            &[
                ("blk.0.attn_q.weight", &[64]),
                ("markov_w1.weight", &[4]),
                ("blk.61.nextn.eh_proj.weight", &[64, 64]),
            ],
        );
        let mut found = find_gguf_tensors(
            Cursor::new(bytes),
            &want(&["markov_w1.weight", "blk.61.nextn.eh_proj.weight", "nope"]),
        )
        .expect("tensor scan");
        found.sort();
        assert_eq!(
            found,
            want(&["blk.61.nextn.eh_proj.weight", "markov_w1.weight"])
        );
    }

    // Every dimension count GGUF allows, so a 1-D bias or a 4-D tensor does
    // not desynchronise the walk and lose everything after it.
    #[test]
    fn every_tensor_rank_keeps_the_walk_aligned() {
        let bytes = gguf(
            3,
            &[],
            &[
                ("one.weight", &[8]),
                ("two.weight", &[8, 8]),
                ("three.weight", &[8, 8, 8]),
                ("four.weight", &[8, 8, 8, 8]),
                ("markov_w1.weight", &[4]),
            ],
        );
        let found = find_gguf_tensors(Cursor::new(bytes), &want(&["markov_w1.weight"]))
            .expect("tensor scan");
        assert_eq!(found, want(&["markov_w1.weight"]));
    }

    // v1 put string lengths and dimensions in u32s. llama.cpp itself refuses
    // that version, so misparsing it as v2 would invent tensor names.
    #[test]
    fn a_version_1_file_is_refused_rather_than_misread() {
        let bytes = gguf(1, &[], &[("markov_w1.weight", &[4])]);
        assert!(find_gguf_tensors(Cursor::new(bytes), &want(&["markov_w1.weight"])).is_err());
    }

    #[test]
    fn asking_for_nothing_reads_nothing() {
        let bytes = gguf(3, &[], &[("token_embd.weight", &[8])]);
        assert!(find_gguf_tensors(Cursor::new(bytes), &[])
            .expect("tensor scan")
            .is_empty());
    }
}
