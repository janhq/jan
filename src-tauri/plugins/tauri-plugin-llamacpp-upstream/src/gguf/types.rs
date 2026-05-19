use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::convert::TryFrom;
use std::io;

#[derive(Debug, Clone, Copy)]
#[repr(u32)]
pub enum GgufValueType {
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
    pub version: u32,
    pub tensor_count: u64,
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KVCacheEstimate {
    pub size: u64,
    pub per_token_size: u64,
}
#[derive(Debug, thiserror::Error)]
pub enum KVCacheError {
    #[error("Invalid metadata: architecture not found")]
    ArchitectureNotFound,
    #[error("Invalid metadata: block_count not found or invalid")]
    BlockCountInvalid,
    #[error("Invalid metadata: head_count not found or invalid")]
    HeadCountInvalid,
    #[error("Invalid metadata: embedding_length not found or invalid")]
    EmbeddingLengthInvalid,
    #[error("Invalid metadata: context_length not found or invalid")]
    ContextLengthInvalid,
}

impl serde::Serialize for KVCacheError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}


#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub enum ModelSupportStatus {
    #[serde(rename = "RED")]
    Red,
    #[serde(rename = "YELLOW")]
    Yellow,
    #[serde(rename = "GREEN")]
    Green,
}
