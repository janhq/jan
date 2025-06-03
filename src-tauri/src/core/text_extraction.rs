use anyhow::{anyhow, Result};
use base64::{engine::general_purpose, Engine as _};
use encoding_rs::UTF_8;
use std::path::Path;

/// Extract text from a file based on its content and type
pub async fn extract_text_from_file_content(
    content_bytes: &[u8],
    file_path: &str,
) -> Result<String> {
    // Determine file type from extension
    let file_extension = Path::new(file_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_lowercase();

    match file_extension.as_str() {
        // Plain text files
        "txt" | "md" | "json" | "html" | "css" | "js" | "ts" | "py" | "rs" | "xml" | "yaml" | "yml" => {
            extract_text_content(content_bytes)
        }
        // DOCX files
        "docx" => extract_docx_text(content_bytes),
        // PDF files
        "pdf" => extract_pdf_text(content_bytes),
        _ => Err(anyhow!("Unsupported file type: {}", file_extension)),
    }
}

/// Extract text from base64 encoded content
pub async fn extract_text_from_base64(
    base64_content: &str,
    file_path: &str,
) -> Result<String> {
    // Decode base64 content
    let content_bytes = general_purpose::STANDARD
        .decode(base64_content)
        .map_err(|e| anyhow!("Failed to decode base64 content: {}", e))?;

    extract_text_from_file_content(&content_bytes, file_path).await
}

/// Extract text from file path by reading the file
pub async fn extract_text_from_file_path(file_path: &str) -> Result<String> {
    // Read file content
    let content_bytes = tokio::fs::read(file_path)
        .await
        .map_err(|e| anyhow!("Failed to read file: {}", e))?;

    extract_text_from_file_content(&content_bytes, file_path).await
}

/// Extract text content from plain text files with encoding detection
fn extract_text_content(content_bytes: &[u8]) -> Result<String> {
    // Try UTF-8 first
    if let Ok(text) = std::str::from_utf8(content_bytes) {
        return Ok(text.to_string());
    }

    // Use encoding_rs for robust encoding detection
    let (cow, _encoding_used, had_errors) = UTF_8.decode(content_bytes);
    
    if had_errors {
        // Try to detect encoding from BOM
        if let Some((encoding, _bom_length)) = encoding_rs::Encoding::for_bom(content_bytes) {
            let (decoded_text, _, had_errors) = encoding.decode(content_bytes);
            
            if had_errors {
                log::warn!("Text extraction had encoding errors, some characters may be corrupted");
            }
            
            Ok(decoded_text.into_owned())
        } else {
            // Fallback to UTF-8 with replacement characters
            log::warn!("Could not detect encoding, using UTF-8 with replacement characters");
            Ok(cow.into_owned())
        }
    } else {
        Ok(cow.into_owned())
    }
}

/// Extract text from DOCX files
fn extract_docx_text(content_bytes: &[u8]) -> Result<String> {
    match docx_rs::read_docx(content_bytes) {
        Ok(docx) => {
            let mut text_content = String::new();
            
            // Extract text from document children
            for child in &docx.document.children {
                match child {
                    docx_rs::DocumentChild::Paragraph(paragraph) => {
                        for run in &paragraph.children {
                            match run {
                                docx_rs::ParagraphChild::Run(run) => {
                                    for run_child in &run.children {
                                        if let docx_rs::RunChild::Text(text) = run_child {
                                            text_content.push_str(&text.text);
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                        text_content.push('\n');
                    }
                    _ => {}
                }
            }
            
            Ok(text_content.trim().to_string())
        }
        Err(e) => Err(anyhow!("Failed to parse DOCX file: {}", e)),
    }
}

/// Extract text from PDF files
fn extract_pdf_text(content_bytes: &[u8]) -> Result<String> {
    match pdf_extract::extract_text_from_mem(content_bytes) {
        Ok(text) => Ok(text),
        Err(e) => Err(anyhow!("Failed to extract text from PDF: {}", e)),
    }
}