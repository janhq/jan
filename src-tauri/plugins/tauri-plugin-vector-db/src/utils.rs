use crate::VectorDBError;

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> Result<f32, VectorDBError> {
    if a.len() != b.len() {
        return Err(VectorDBError::InvalidInput(
            "Vector dimensions don't match".to_string(),
        ));
    }

    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let mag_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let mag_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if mag_a == 0.0 || mag_b == 0.0 { return Ok(0.0); }
    Ok(dot / (mag_a * mag_b))
}

pub fn to_le_bytes_vec(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect::<Vec<u8>>()
}

pub fn from_le_bytes_vec(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect::<Vec<f32>>()
}

