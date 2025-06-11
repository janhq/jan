// Copyright 2023-2025 Jan Authors
// SPDX-License-Identifier: MIT

//! Document text extraction utilities.

use std::path::Path;
use encoding_rs::Encoding;

use crate::{
    error::{Error, Result},
};

/// Extract text from a file based on its extension
pub async fn extract_text_from_file(file_path: &str) -> Result<String> {
    let path = Path::new(file_path);
    
    // Check if file exists
    if !path.exists() {
        return Err(Error::not_found(format!("File not found: {}", file_path)));
    }
    
    // Get file extension
    let extension = path.extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_lowercase();
    
    log::info!("Extracting text from file: {} (type: {})", file_path, extension);
    
    match extension.as_str() {
        "pdf" => extract_from_pdf(file_path).await,
        "docx" => extract_from_docx(file_path).await,
        "txt" | "md" | "markdown" | "log" | "csv" | "json" | "xml" | "html" | "htm" => {
            extract_from_text_file(file_path).await
        }
        _ => {
            // Try to extract as text file for unknown extensions
            log::warn!("Unknown file extension '{}', attempting to read as text file", extension);
            extract_from_text_file(file_path).await
        }
    }
}

/// Extract text from PDF files
async fn extract_from_pdf(file_path: &str) -> Result<String> {
    log::debug!("Extracting text from PDF: {}", file_path);
    
    let bytes = tokio::fs::read(file_path).await
        .map_err(|e| Error::file_system(format!("Failed to read PDF file: {}", e)))?;
    
    pdf_extract::extract_text_from_mem(&bytes)
        .map_err(|e| Error::document_parsing(format!("Failed to extract text from PDF: {}", e)))
}

/// Extract text from DOCX files
async fn extract_from_docx(file_path: &str) -> Result<String> {
    log::debug!("Extracting text from DOCX: {}", file_path);
    
    let bytes = tokio::fs::read(file_path).await
        .map_err(|e| Error::file_system(format!("Failed to read DOCX file: {}", e)))?;
    
    // Use docx-rs to extract text
    let doc = docx_rs::read_docx(&bytes)
        .map_err(|e| Error::document_parsing(format!("Failed to parse DOCX file: {}", e)))?;
    
    // Extract text from all paragraphs
    let mut text = String::new();
    for child in &doc.document.children {
        extract_text_from_docx_element(child, &mut text);
    }
    
    Ok(text)
}

/// Recursively extract text from DOCX elements
fn extract_text_from_docx_element(element: &docx_rs::DocumentChild, text: &mut String) {
    match element {
        docx_rs::DocumentChild::Paragraph(para) => {
            for child in &para.children {
                extract_text_from_paragraph_child(child, text);
            }
            text.push('\n');
        }
        docx_rs::DocumentChild::Table(_table) => {
            // TODO: Implement table text extraction
            // The docx-rs API for tables needs further investigation
            text.push_str("[Table content not extracted]\n");
        }
        _ => {} // Skip other elements for now
    }
}

/// Extract text from paragraph children
fn extract_text_from_paragraph_child(child: &docx_rs::ParagraphChild, text: &mut String) {
    match child {
        docx_rs::ParagraphChild::Run(run) => {
            for run_child in &run.children {
                if let docx_rs::RunChild::Text(text_element) = run_child {
                    text.push_str(&text_element.text);
                }
            }
        }
        _ => {} // Skip other paragraph children for now
    }
}

/// Extract text from plain text files with encoding detection
async fn extract_from_text_file(file_path: &str) -> Result<String> {
    log::debug!("Extracting text from text file: {}", file_path);
    
    let bytes = tokio::fs::read(file_path).await
        .map_err(|e| Error::file_system(format!("Failed to read text file: {}", e)))?;
    
    // Try to detect encoding
    let (text, encoding_used, had_errors) = detect_encoding_and_decode(&bytes);
    
    if had_errors {
        log::warn!("Encoding errors detected while reading file: {} (used encoding: {})", 
                  file_path, encoding_used.name());
    } else {
        log::debug!("Successfully decoded file using encoding: {}", encoding_used.name());
    }
    
    Ok(text)
}

/// Detect encoding and decode bytes to string
fn detect_encoding_and_decode(bytes: &[u8]) -> (String, &'static Encoding, bool) {
    // Try UTF-8 first
    if let Ok(text) = std::str::from_utf8(bytes) {
        return (text.to_string(), encoding_rs::UTF_8, false);
    }
    
    // Try to detect encoding using chardet-like heuristics
    let encoding = detect_encoding(bytes);
    let (text, _, had_errors) = encoding.decode(bytes);
    
    (text.into_owned(), encoding, had_errors)
}

/// Simple encoding detection
fn detect_encoding(bytes: &[u8]) -> &'static Encoding {
    // Check for BOM markers
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return encoding_rs::UTF_8;
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return encoding_rs::UTF_16LE;
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return encoding_rs::UTF_16BE;
    }
    
    // Simple heuristics for common encodings
    let mut null_count = 0;
    let mut high_bit_count = 0;
    let sample_size = bytes.len().min(1024);
    
    for &byte in &bytes[..sample_size] {
        if byte == 0 {
            null_count += 1;
        } else if byte >= 0x80 {
            high_bit_count += 1;
        }
    }
    
    // If we have null bytes, it might be UTF-16
    if null_count > sample_size / 20 {
        return encoding_rs::UTF_16LE; // Default to LE
    }
    
    // If we have high bit bytes, try Windows-1252 (common for Western text)
    if high_bit_count > 0 {
        return encoding_rs::WINDOWS_1252;
    }
    
    // Default to UTF-8
    encoding_rs::UTF_8
}

/// Clean and normalize extracted text
pub fn clean_extracted_text(text: &str) -> String {
    text
        // Replace multiple whitespace with single space
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        // Remove excessive newlines
        .replace('\n', " ")
        // Trim
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;
    use std::io::Write;

    #[tokio::test]
    async fn test_extract_from_text_file() {
        let mut temp_file = NamedTempFile::new().unwrap();
        let test_content = "This is a test file.\nWith multiple lines.\nAnd some content.";
        temp_file.write_all(test_content.as_bytes()).unwrap();
        
        let result = extract_from_text_file(temp_file.path().to_str().unwrap()).await;
        assert!(result.is_ok());
        
        let extracted = result.unwrap();
        assert!(extracted.contains("This is a test file"));
        assert!(extracted.contains("multiple lines"));
    }

    #[tokio::test]
    async fn test_extract_from_nonexistent_file() {
        let result = extract_text_from_file("/nonexistent/file.txt").await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), Error::NotFound(_)));
    }

    #[test]
    fn test_detect_encoding() {
        // Test UTF-8 with BOM
        let utf8_bom = [0xEF, 0xBB, 0xBF, 0x48, 0x65, 0x6C, 0x6C, 0x6F]; // "Hello" with BOM
        assert_eq!(detect_encoding(&utf8_bom), encoding_rs::UTF_8);
        
        // Test UTF-16LE with BOM
        let utf16le_bom = [0xFF, 0xFE, 0x48, 0x00, 0x65, 0x00]; // "He" in UTF-16LE with BOM
        assert_eq!(detect_encoding(&utf16le_bom), encoding_rs::UTF_16LE);
        
        // Test plain ASCII
        let ascii = b"Hello World";
        assert_eq!(detect_encoding(ascii), encoding_rs::UTF_8);
    }

    #[test]
    fn test_clean_extracted_text() {
        let messy_text = "  This   is\n\na  test   \n  with\tmultiple\n\n\nspaces  ";
        let cleaned = clean_extracted_text(messy_text);
        assert_eq!(cleaned, "This is a test with multiple spaces");
    }

    #[test]
    fn test_encoding_detection_and_decode() {
        let test_text = "Hello, 世界! This is a test.";
        let utf8_bytes = test_text.as_bytes();
        
        let (decoded, encoding, had_errors) = detect_encoding_and_decode(utf8_bytes);
        assert_eq!(decoded, test_text);
        assert_eq!(encoding, encoding_rs::UTF_8);
        assert!(!had_errors);
    }

    #[tokio::test]
    async fn test_file_extension_detection() {
        // Test that we handle different extensions properly
        let mut temp_file = NamedTempFile::with_suffix(".txt").unwrap();
        temp_file.write_all(b"Test content").unwrap();
        
        let result = extract_text_from_file(temp_file.path().to_str().unwrap()).await;
        assert!(result.is_ok());
        
        let extracted = result.unwrap();
        assert_eq!(extracted, "Test content");
    }
}