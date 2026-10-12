use crate::{RagError, MAX_PARSE_FILE_SIZE};
use std::borrow::Cow;
use std::fs;
use std::io::{Cursor, Read};
use std::panic::{catch_unwind, AssertUnwindSafe};
use calamine::{open_workbook_auto, DataType, Reader as _};
use chardetng::EncodingDetector;
use csv as csv_crate;
use quick_xml::events::Event;
use quick_xml::Reader;
use zip::read::ZipArchive;

pub fn parse_pdf(file_path: &str) -> Result<String, RagError> {
    let metadata = fs::metadata(file_path)?;
    if metadata.len() > MAX_PARSE_FILE_SIZE {
        return Err(RagError::ParseError("File too large (max 200MB)".to_string()));
    }
    let bytes = fs::read(file_path)?;
    // pdf-extract can panic on some malformed PDFs; guard to avoid crashing the app
    let text = match catch_unwind(AssertUnwindSafe(|| pdf_extract::extract_text_from_mem(&bytes))) {
        Ok(Ok(t)) => t,
        Ok(Err(e)) => return Err(RagError::ParseError(format!("PDF parse error: {}", e))),
        Err(payload) => {
            let reason = if let Some(s) = payload.downcast_ref::<&str>() {
                *s
            } else if let Some(s) = payload.downcast_ref::<String>() {
                s.as_str()
            } else {
                "unknown parser panic"
            };
            return Err(RagError::ParseError(format!(
                "PDF parsing failed unexpectedly: {}",
                reason
            )));
        }
    };

    // Validate that the PDF has extractable text (not image-based/scanned)
    // Count meaningful characters (excluding whitespace)
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
    if metadata.len() > MAX_PARSE_FILE_SIZE {
        return Err(RagError::ParseError("File too large (max 200MB)".to_string()));
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
    if metadata.len() > MAX_PARSE_FILE_SIZE {
        return Err(RagError::ParseError("File too large (max 200MB)".to_string()));
    }
    let mut rdr = csv_crate::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_path(file_path)
        .map_err(|e| RagError::ParseError(e.to_string()))?;
    // Re-serialise through the csv writer so a cell holding the delimiter, a
    // quote or a newline stays one cell instead of shifting the columns after it.
    let mut wtr = csv_crate::WriterBuilder::new()
        .flexible(true)
        .from_writer(Vec::new());
    for rec in rdr.records() {
        let rec = rec.map_err(|e| RagError::ParseError(e.to_string()))?;
        wtr.write_record(&rec)
            .map_err(|e| RagError::ParseError(e.to_string()))?;
    }
    let bytes = wtr
        .into_inner()
        .map_err(|e| RagError::ParseError(e.to_string()))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

const SECS_PER_DAY: i64 = 86_400;

/// Largest serial Excel accepts (9999-12-31); anything past it is not a date.
const MAX_EXCEL_SERIAL: f64 = 2_958_466.0;

/// Renders a cell for the model. Date cells arrive as Excel serial numbers,
/// which a model cannot read as dates, so they become ISO 8601 text.
fn format_cell(cell: &DataType) -> String {
    match cell {
        DataType::DateTime(serial) => excel_serial_to_iso(*serial),
        DataType::Duration(days) => excel_duration(*days),
        other => other.to_string(),
    }
}

/// Converts a 1900-system serial. calamine already shifts 1904-system
/// workbooks onto this system, so no epoch detection is needed here.
fn excel_serial_to_iso(serial: f64) -> String {
    if !serial.is_finite() || !(0.0..MAX_EXCEL_SERIAL).contains(&serial) {
        return serial.to_string();
    }
    let total_secs = (serial * SECS_PER_DAY as f64).round() as i64;
    let serial_days = total_secs.div_euclid(SECS_PER_DAY);
    let secs_of_day = total_secs.rem_euclid(SECS_PER_DAY);
    let time = format!(
        "{:02}:{:02}:{:02}",
        secs_of_day / 3600,
        secs_of_day % 3600 / 60,
        secs_of_day % 60
    );
    // Serial 0 is Excel's "1900-01-00": the cell holds only a time of day.
    if serial_days == 0 {
        return time;
    }
    // Excel counts a 1900-02-29 that never existed (serial 60), so serials
    // before it are one day behind the 1899-12-30 epoch used for later ones.
    let days_since_epoch = if serial_days < 60 { serial_days + 1 } else { serial_days };
    // 1899-12-30 is 25569 days before 1970-01-01.
    let (y, m, d) = civil_from_days(days_since_epoch - 25_569);
    let date = format!("{:04}-{:02}-{:02}", y, m, d);
    if secs_of_day == 0 {
        date
    } else {
        format!("{}T{}", date, time)
    }
}

/// Renders an Excel duration (fractional days) as elapsed `[h]:mm:ss`.
fn excel_duration(days: f64) -> String {
    if !days.is_finite() || days.abs() >= MAX_EXCEL_SERIAL {
        return days.to_string();
    }
    let total_secs = (days * SECS_PER_DAY as f64).round() as i64;
    let sign = if total_secs < 0 { "-" } else { "" };
    let secs = total_secs.abs();
    format!("{}{}:{:02}:{:02}", sign, secs / 3600, secs % 3600 / 60, secs % 60)
}

/// Proleptic Gregorian date for a day count relative to 1970-01-01
/// (Howard Hinnant's civil_from_days), avoiding a date-library dependency.
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

fn parse_spreadsheet(file_path: &str) -> Result<String, RagError> {
    let metadata = fs::metadata(file_path)?;
    if metadata.len() > MAX_PARSE_FILE_SIZE {
        return Err(RagError::ParseError("File too large (max 200MB)".to_string()));
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
                    .map(format_cell)
                    .collect::<Vec<_>>()
                    .join("\t");
                out.push_str(&cells);
                out.push('\n');
            }
            out.push('\n');
        }
    }
    Ok(out)
}

fn parse_pptx(file_path: &str) -> Result<String, RagError> {
    let metadata = std::fs::metadata(file_path)?;
    if metadata.len() > MAX_PARSE_FILE_SIZE {
        return Err(RagError::ParseError("File too large (max 200MB)".to_string()));
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
    if metadata.len() > MAX_PARSE_FILE_SIZE {
        return Err(RagError::ParseError("File too large (max 200MB)".to_string()));
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

    #[test]
    fn date_only_serial_renders_as_iso_date() {
        assert_eq!(format_cell(&DataType::DateTime(45123.0)), "2023-07-16");
    }

    #[test]
    fn serial_with_time_renders_as_iso_datetime() {
        assert_eq!(format_cell(&DataType::DateTime(45123.5)), "2023-07-16T12:00:00");
    }

    #[test]
    fn time_only_serial_renders_as_time() {
        assert_eq!(format_cell(&DataType::DateTime(0.75)), "18:00:00");
    }

    #[test]
    fn serials_before_the_phantom_leap_day_are_not_shifted() {
        assert_eq!(format_cell(&DataType::DateTime(1.0)), "1900-01-01");
        assert_eq!(format_cell(&DataType::DateTime(59.0)), "1900-02-28");
        assert_eq!(format_cell(&DataType::DateTime(61.0)), "1900-03-01");
    }

    #[test]
    fn seconds_round_instead_of_truncating() {
        // 10:00:00 as a float is slightly below the exact value.
        assert_eq!(
            format_cell(&DataType::DateTime(44927.0 + 10.0 / 24.0)),
            "2023-01-01T10:00:00"
        );
    }

    #[test]
    fn durations_render_as_elapsed_time() {
        assert_eq!(format_cell(&DataType::Duration(1.5)), "36:00:00");
    }

    #[test]
    fn iso_variants_pass_through() {
        assert_eq!(
            format_cell(&DataType::DateTimeIso("2024-02-29T08:15:00".into())),
            "2024-02-29T08:15:00"
        );
        assert_eq!(format_cell(&DataType::DurationIso("PT1H".into())), "PT1H");
    }

    #[test]
    fn csv_cells_with_delimiters_quotes_or_newlines_are_quoted() {
        let path = std::env::temp_dir().join(format!(
            "jan-rag-parse-csv-{}.csv",
            std::process::id()
        ));
        fs::write(&path, "name,note\n\"Doe, Jane\",\"say \"\"hi\"\"\nthere\"\nplain,x\n")
            .unwrap();
        let out = parse_csv(path.to_str().unwrap());
        let _ = fs::remove_file(&path);
        assert_eq!(
            out.unwrap(),
            "name,note\n\"Doe, Jane\",\"say \"\"hi\"\"\nthere\"\nplain,x\n"
        );
    }
}
