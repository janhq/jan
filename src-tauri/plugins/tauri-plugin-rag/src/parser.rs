use crate::{RagError, MAX_PDF_FILE_SIZE, MAX_SPREADSHEET_FILE_SIZE, MAX_CSV_FILE_SIZE, MAX_PPTX_FILE_SIZE, MAX_DOCX_FILE_SIZE};
use std::borrow::Cow;
use std::fs;
use std::io::{Cursor, Read};
use std::panic::{catch_unwind, AssertUnwindSafe};
use calamine::{open_workbook_auto, DataType, Reader as _};
use chardetng::EncodingDetector;
use csv as csv_crate;
use html2text;
use infer;
use quick_xml::events::Event;
use quick_xml::Reader;
use zip::read::ZipArchive;

pub fn parse_pdf(file_path: &str) -> Result<String, RagError> {
    let metadata = fs::metadata(file_path)?;
    if metadata.len() > MAX_PDF_FILE_SIZE {
        return Err(RagError::ParseError("File too large (max 20MB)".to_string()));
    }
    let bytes = fs::read(file_path)?;

    // Try pdf-extract first (better formatting), fall back to pdf_oxide if it panics or errors
    let text = match catch_unwind(AssertUnwindSafe(|| pdf_extract::extract_text_from_mem(&bytes))) {
        Ok(Ok(t)) => t,
        Ok(Err(e)) => {
            log::warn!("pdf-extract failed ({}), falling back to pdf_oxide", e);
            extract_with_pdf_oxide(file_path)?
        }
        Err(payload) => {
            let reason = if let Some(s) = payload.downcast_ref::<&str>() {
                (*s).to_string()
            } else if let Some(s) = payload.downcast_ref::<String>() {
                s.clone()
            } else {
                "unknown parser panic".to_string()
            };
            log::warn!("pdf-extract panicked ({}), falling back to pdf_oxide", reason);
            extract_with_pdf_oxide(file_path)?
        }
    };

    // Validate that the PDF has extractable text (not image-based/scanned).
    // This guard applies to output from both pdf-extract and the pdf_oxide fallback,
    // so image-based PDFs that also crash pdf-extract are caught here instead of
    // silently returning an empty string.
    let meaningful_chars = text.chars()
        .filter(|c| !c.is_whitespace())
        .count();

    // Require at least 50 non-whitespace characters to consider it a text PDF
    // This threshold filters out PDFs that are purely images or scanned documents
    if meaningful_chars < 50 {
        return Err(RagError::ParseError(
            "PDF appears to be image-based or scanned. OCR is not supported yet. Please use a text-based PDF.".to_string()
        ));
    }

    Ok(text)
}

fn extract_with_pdf_oxide(file_path: &str) -> Result<String, RagError> {
    let mut doc = pdf_oxide::PdfDocument::open(file_path)
        .map_err(|e| RagError::ParseError(format!("Failed to open PDF: {}", e)))?;
    let page_count = doc.page_count()
        .map_err(|e| RagError::ParseError(format!("Failed to get page count: {}", e)))?;
    let mut all_text = String::new();
    for i in 0..page_count {
        match doc.extract_text(i) {
            Ok(text) => {
                if !all_text.is_empty() {
                    all_text.push_str("\n\n");
                }
                all_text.push_str(&text);
            }
            Err(e) => log::warn!("pdf_oxide: failed to extract page {}: {}", i, e),
        }
    }
    Ok(all_text)
}

pub fn parse_text(file_path: &str) -> Result<String, RagError> {
    read_text_auto(file_path)
}

pub fn parse_document(file_path: &str, file_type: &str) -> Result<String, RagError> {
    match file_type.to_lowercase().as_str() {
        "pdf" | "application/pdf" => parse_pdf(file_path),
        "txt" | "text/plain" | "md" | "text/markdown"
        // JavaScript / TypeScript
        | "js" | "mjs" | "cjs" | "ts" | "mts" | "cts" | "jsx" | "tsx"
        // Python
        | "py" | "pyw" | "pyi"
        // C / C++
        | "c" | "h" | "cpp" | "cc" | "cxx" | "hpp" | "hh" | "hxx"
        // Systems languages
        | "rs" | "go" | "swift" | "zig"
        // JVM languages
        | "java" | "kt" | "kts" | "scala" | "groovy" | "clj" | "cljs" | "hs" | "lhs" | "ml" | "mli" | "f" | "f77" | "f90" | "f95" | "f03" | "f08"
        // Scripting languages
        | "rb" | "php" | "lua" | "pl" | "pm" | "r" | "jl" | "vbs" | "asm" | "s" | "m" | "mm" | "pas" | "pp" | "erl" | "hrl" | "ex" | "exs"
        // .NET
        | "cs" | "fs" | "vb" | "xaml" | "csproj" | "sln"
        // CUDA
        | "cu" | "cuh"
        // Shaders
        | "hlsl" | "glsl" | "cg" | "shader"
        // Shell
        | "sh" | "bash" | "zsh" | "fish" | "ps1" | "psm1" | "bat" | "cmd"
        // Web
        | "css" | "scss" | "sass" | "less" | "vue" | "svelte" | "astro" | "asp" | "aspx" | "jsp"
        // Data / config formats
        | "json" | "jsonc" | "yaml" | "yml" | "toml" | "xml" | "ini"
        | "cfg" | "conf" | "config" | "env" | "properties" | "lock"
        // Query / markup
        | "sql" | "graphql" | "gql" | "tex" | "rst" | "adoc" | "textile"
        // Misc text
        | "log" | "diff" | "patch" | "gitignore" | "dockerfile" | "makefile" | "cmake" => parse_text(file_path),
        "csv" | "text/csv" => parse_csv(file_path),
        // Excel family via calamine
        "xlsx"
        | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        | "xls"
        | "application/vnd.ms-excel"
        | "ods"
        | "application/vnd.oasis.opendocument.spreadsheet" => parse_spreadsheet(file_path),
        // PowerPoint
        "pptx"
        | "application/vnd.openxmlformats-officedocument.presentationml.presentation" => parse_pptx(file_path),
        // HTML
        "html" | "htm" | "text/html" => parse_html(file_path),
        "docx"
        | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => {
            parse_docx(file_path)
        }
        other => {
            // Try MIME sniffing when extension or MIME is unknown
            match infer::get_from_path(file_path) {
                Ok(Some(k)) => {
                    let mime = k.mime_type();
                    // Guard against infinite recursion if mime matches the unknown extension
                    if mime != other {
                        return parse_document(file_path, mime);
                    }
                    Err(RagError::UnsupportedFileType(other.to_string()))
                }
                _ => {
                    // infer returned None → no binary magic bytes detected, treat as plain text
                    parse_text(file_path)
                }
            }
        }
    }
}

fn parse_docx(file_path: &str) -> Result<String, RagError> {
    let metadata = std::fs::metadata(file_path)?;
    if metadata.len() > MAX_DOCX_FILE_SIZE {
        return Err(RagError::ParseError("File too large (max 20MB)".to_string()));
    }
    let file = std::fs::File::open(file_path)?;
    let mut zip = ZipArchive::new(file).map_err(|e| RagError::ParseError(e.to_string()))?;

    // Standard DOCX stores document text at word/document.xml
    let mut doc_xml = match zip.by_name("word/document.xml") {
        Ok(f) => f,
        Err(_) => return Err(RagError::ParseError("document.xml not found".into())),
    };
    let mut xml_content = String::new();
    doc_xml
        .read_to_string(&mut xml_content)
        .map_err(|e| RagError::ParseError(e.to_string()))?;

    // Parse XML and extract text from w:t nodes; add newlines on w:p boundaries
    let mut reader = Reader::from_str(&xml_content);
    reader.trim_text(true);
    let mut buf = Vec::new();
    let mut result = String::new();
    let mut in_text = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name: String = reader
                    .decoder()
                    .decode(e.name().as_ref())
                    .unwrap_or(Cow::Borrowed(""))
                    .into_owned();
                if name.ends_with(":t") || name == "w:t" || name == "t" {
                    in_text = true;
                }
            }
            Ok(Event::End(e)) => {
                let name: String = reader
                    .decoder()
                    .decode(e.name().as_ref())
                    .unwrap_or(Cow::Borrowed(""))
                    .into_owned();
                if name.ends_with(":t") || name == "w:t" || name == "t" {
                    in_text = false;
                    result.push(' ');
                }
                if name.ends_with(":p") || name == "w:p" || name == "p" {
                    // Paragraph end – add newline
                    result.push_str("\n\n");
                }
            }
            Ok(Event::Text(t)) => {
                if in_text {
                    let text = t.unescape().unwrap_or_default();
                    result.push_str(&text);
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(RagError::ParseError(e.to_string())),
            _ => {}
        }
    }

    // Normalize whitespace
    let normalized = result
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Ok(normalized)
}

fn parse_csv(file_path: &str) -> Result<String, RagError> {
    let metadata = fs::metadata(file_path)?;
    if metadata.len() > MAX_CSV_FILE_SIZE {
        return Err(RagError::ParseError("File too large (max 20MB)".to_string()));
    }
    let mut rdr = csv_crate::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_path(file_path)
        .map_err(|e| RagError::ParseError(e.to_string()))?;
    let mut out = String::new();
    for rec in rdr.records() {
        let rec = rec.map_err(|e| RagError::ParseError(e.to_string()))?;
        out.push_str(&rec.iter().collect::<Vec<_>>().join(", "));
        out.push('\n');
    }
    Ok(out)
}

fn parse_spreadsheet(file_path: &str) -> Result<String, RagError> {
    let metadata = fs::metadata(file_path)?;
    if metadata.len() > MAX_SPREADSHEET_FILE_SIZE {
        return Err(RagError::ParseError("File too large (max 20MB)".to_string()));
    }
    let mut workbook = open_workbook_auto(file_path)
        .map_err(|e| RagError::ParseError(e.to_string()))?;
    let mut out = String::new();
    for sheet_name in workbook.sheet_names().to_owned() {
        if let Ok(range) = workbook.worksheet_range(&sheet_name) {
            out.push_str(&format!("# Sheet: {}\n", sheet_name));
            for row in range.rows() {
                let cells = row
                    .iter()
                    .map(|c| match c {
                        DataType::Empty => "".to_string(),
                        DataType::String(s) => s.to_string(),
                        DataType::Float(f) => format!("{}", f),
                        DataType::Int(i) => i.to_string(),
                        DataType::Bool(b) => b.to_string(),
                        DataType::DateTime(f) => format!("{}", f),
                        other => other.to_string(),
                    })
                    .collect::<Vec<_>>()
                    .join("\t");
                out.push_str(&cells);
                out.push('\n');
            }
            out.push_str("\n");
        }
    }
    Ok(out)
}

fn parse_pptx(file_path: &str) -> Result<String, RagError> {
    let metadata = std::fs::metadata(file_path)?;
    if metadata.len() > MAX_PPTX_FILE_SIZE {
        return Err(RagError::ParseError("File too large (max 20MB)".to_string()));
    }
    let file = std::fs::File::open(file_path)?;
    let mut zip = ZipArchive::new(file).map_err(|e| RagError::ParseError(e.to_string()))?;

    // Collect slide files: ppt/slides/slide*.xml
    let mut slides = Vec::new();
    for i in 0..zip.len() {
        let name = zip.by_index(i).map(|f| f.name().to_string()).unwrap_or_default();
        if name.starts_with("ppt/slides/") && name.ends_with(".xml") {
            slides.push(name);
        }
    }
    slides.sort();

    let mut output = String::new();
    for slide_name in slides {
        let mut file = zip.by_name(&slide_name).map_err(|e| RagError::ParseError(e.to_string()))?;
        let mut xml = String::new();
        file.read_to_string(&mut xml).map_err(|e| RagError::ParseError(e.to_string()))?;
        output.push_str(&extract_pptx_text(&xml));
        output.push_str("\n\n");
    }
    Ok(output)
}

fn extract_pptx_text(xml: &str) -> String {
    let mut reader = Reader::from_str(xml);
    reader.trim_text(true);
    let mut buf = Vec::new();
    let mut result = String::new();
    let mut in_text = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name: String = reader
                    .decoder()
                    .decode(e.name().as_ref())
                    .unwrap_or(Cow::Borrowed(""))
                    .into_owned();
                if name.ends_with(":t") || name == "a:t" || name == "t" {
                    in_text = true;
                }
            }
            Ok(Event::End(e)) => {
                let name: String = reader
                    .decoder()
                    .decode(e.name().as_ref())
                    .unwrap_or(Cow::Borrowed(""))
                    .into_owned();
                if name.ends_with(":t") || name == "a:t" || name == "t" {
                    in_text = false;
                    result.push(' ');
                }
            }
            Ok(Event::Text(t)) => {
                if in_text {
                    let text = t.unescape().unwrap_or_default();
                    result.push_str(&text);
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }
    result
}

fn parse_html(file_path: &str) -> Result<String, RagError> {
    let html = read_text_auto(file_path)?;
    // 80-column wrap default
    Ok(html2text::from_read(Cursor::new(html), 80))
}

fn read_text_auto(file_path: &str) -> Result<String, RagError> {
    let metadata = fs::metadata(file_path)?;
    if metadata.len() > 50 * 1024 * 1024 {
        return Err(RagError::ParseError("File too large (max 50MB)".to_string()));
    }
    let bytes = fs::read(file_path)?;
    // Detect encoding
    let mut detector = EncodingDetector::new();
    detector.feed(&bytes, true);
    let enc = detector.guess(None, true);
    let (decoded, _, had_errors) = enc.decode(&bytes);
    if had_errors {
        // fallback to UTF-8 lossy
        Ok(String::from_utf8_lossy(&bytes).to_string())
    } else {
        Ok(decoded.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::path::PathBuf;

    // Minimal valid single-page PDF containing the text "Hello pdf_oxide test".
    // Byte offsets in the xref table must stay in sync with the object positions.
    const MINIMAL_PDF: &[u8] = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length 52 >>\nstream\nBT /F1 24 Tf 100 700 Td (Hello pdf_oxide test) Tj ET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000015 00000 n \n0000000064 00000 n \n0000000121 00000 n \n0000000247 00000 n \n0000000349 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n419\n%%EOF\n";

    fn write_temp_file(name: &str, contents: &[u8]) -> PathBuf {
        let mut path = env::temp_dir();
        path.push(format!(
            "jan-rag-test-{}-{}",
            std::process::id(),
            name
        ));
        fs::write(&path, contents).expect("failed to write temp fixture");
        path
    }

    #[test]
    fn extract_with_pdf_oxide_extracts_text_from_valid_pdf() {
        let path = write_temp_file("valid.pdf", MINIMAL_PDF);
        let result = extract_with_pdf_oxide(path.to_str().unwrap());
        let _ = fs::remove_file(&path);

        let text = result.expect("extraction should succeed for valid PDF");
        assert!(
            text.contains("Hello pdf_oxide test"),
            "extracted text should contain the fixture string, got: {:?}",
            text
        );
    }

    #[test]
    fn extract_with_pdf_oxide_errors_on_missing_file() {
        let missing = env::temp_dir().join("jan-rag-test-does-not-exist.pdf");
        let result = extract_with_pdf_oxide(missing.to_str().unwrap());
        assert!(
            matches!(result, Err(RagError::ParseError(_))),
            "missing file should return ParseError, got: {:?}",
            result
        );
    }

    #[test]
    fn extract_with_pdf_oxide_errors_on_invalid_bytes() {
        let path = write_temp_file("invalid.pdf", b"this is not a PDF");
        let result = extract_with_pdf_oxide(path.to_str().unwrap());
        let _ = fs::remove_file(&path);

        assert!(
            matches!(result, Err(RagError::ParseError(_))),
            "invalid bytes should return ParseError, got: {:?}",
            result
        );
    }
}
