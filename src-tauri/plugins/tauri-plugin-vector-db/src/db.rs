use crate::VectorDBError;
use crate::utils::{cosine_similarity, from_le_bytes_vec, to_le_bytes_vec};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[allow(dead_code)]
pub struct FileMetadata {
    pub name: Option<String>,
    pub path: String,
    #[serde(rename = "type")]
    pub file_type: Option<String>,
    pub size: Option<i64>,
}


#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub text: String,
    pub score: Option<f32>,
    pub file_id: String,
    pub chunk_file_order: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AttachmentFileInfo {
    pub id: String,
    pub name: Option<String>,
    pub path: Option<String>,
    #[serde(rename = "type")]
    pub file_type: Option<String>,
    pub size: Option<i64>,
    pub chunk_count: i64,
}

// New minimal chunk input (no id/metadata) for file-scoped insertion
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MinimalChunkInput {
    pub text: String,
    pub embedding: Vec<f32>,
}

// ============================================================================
// Connection & Path Management
// ============================================================================

/// Canonical base directory for all vector-db collections (RAG chunks and the
/// agent memory store). Single source of truth shared by `VectorDBState` and any
/// out-of-plugin consumer so they operate on the same `.db` files.
pub fn default_base_dir() -> PathBuf {
    let mut base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.push("Jan");
    base.push("data");
    base.push("db");
    base
}

pub fn collection_path(base: &Path, name: &str) -> PathBuf {
    let mut p = base.to_path_buf();
    let clean = name.replace(['/', '\\'], "_");
    let filename = format!("{}.db", clean);
    p.push(&filename);
    p
}

pub fn open_or_init_conn(path: &PathBuf) -> Result<Connection, VectorDBError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    let conn = Connection::open(path)?;
    Ok(conn)
}

// ============================================================================
// SQLite-vec Extension Loading
// ============================================================================

pub fn try_load_sqlite_vec(conn: &Connection) -> bool {
    // Check if vec0 module is already available
    if conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS temp.temp_vec USING vec0(embedding float[1])", []).is_ok() {
        let _ = conn.execute("DROP TABLE IF EXISTS temp.temp_vec", []);
        return true;
    }

    unsafe {
        let _ = conn.load_extension_enable();
    }

    let paths = possible_sqlite_vec_paths();
    for p in paths {
        unsafe {
            if conn.load_extension(&p, Some("sqlite3_vec_init")).is_ok()
                && conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS temp.temp_vec USING vec0(embedding float[1])", []).is_ok()
            {
                let _ = conn.execute("DROP TABLE IF EXISTS temp.temp_vec", []);
                return true;
            }
        }
    }

    false
}

pub fn possible_sqlite_vec_paths() -> Vec<String> {
    let mut paths = Vec::new();

    // Dev paths
    paths.push("./src-tauri/resources/bin/sqlite-vec".to_string());
    paths.push("./resources/bin/sqlite-vec".to_string());

    // Exe-relative paths
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let mut d = dir.to_path_buf();
            d.push("resources");
            d.push("bin");
            d.push("sqlite-vec");
            paths.push(d.to_string_lossy().to_string());
        }

        #[cfg(target_os = "macos")]
        {
            if let Some(mac_dir) = exe.parent().and_then(|p| p.parent()) {
                let mut r = mac_dir.to_path_buf();
                r.push("Resources");
                r.push("bin");
                r.push("sqlite-vec");
                paths.push(r.to_string_lossy().to_string());
            }
        }
    }
    paths
}

pub fn ensure_vec_table(conn: &Connection, dimension: usize) -> bool {
    if try_load_sqlite_vec(conn) {
        let create = format!(
            "CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(embedding float[{}])",
            dimension
        );
        match conn.execute(&create, []) {
            Ok(_) => return true,
            Err(e) => {
                println!("[VectorDB] ✗ Failed to create chunks_vec: {}", e);
            }
        }
    }
    false
}

// ============================================================================
// Schema Creation
// ============================================================================

pub fn create_schema(conn: &Connection, dimension: usize) -> Result<bool, VectorDBError> {
    // Files table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            path TEXT UNIQUE NOT NULL,
            name TEXT,
            type TEXT,
            size INTEGER,
            chunk_count INTEGER DEFAULT 0
        )",
        [],
    )?;

    // Chunks table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS chunks (
            id TEXT PRIMARY KEY,
            text TEXT NOT NULL,
            embedding BLOB NOT NULL,
            file_id TEXT,
            chunk_file_order INTEGER,
            FOREIGN KEY (file_id) REFERENCES files(id)
        )",
        [],
    )?;

    conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_id ON chunks(id)", [])?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id)", [])?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_file_order ON chunks(file_id, chunk_file_order)", [])?;

    // Try to create vec virtual table
    let has_ann = ensure_vec_table(conn, dimension);
    Ok(has_ann)
}

// ============================================================================
// Insert Operations
// ============================================================================

pub fn create_file(
    conn: &Connection,
    path: &str,
    name: Option<&str>,
    file_type: Option<&str>,
    size: Option<i64>,
) -> Result<AttachmentFileInfo, VectorDBError> {
    let tx = conn.unchecked_transaction()?;

    // Try get existing by path
    if let Ok(Some(id)) = tx
        .prepare("SELECT id FROM files WHERE path = ?1")
        .and_then(|mut s| s.query_row(params![path], |r| r.get::<_, String>(0)).optional())
    {
        let row: AttachmentFileInfo = {
            let mut stmt = tx.prepare(
                "SELECT id, path, name, type, size, chunk_count FROM files WHERE id = ?1",
            )?;
            stmt.query_row(params![id.as_str()], |r| {
                Ok(AttachmentFileInfo {
                    id: r.get(0)?,
                    path: r.get(1)?,
                    name: r.get(2)?,
                    file_type: r.get(3)?,
                    size: r.get(4)?,
                    chunk_count: r.get(5)?,
                })
            })?
        };
        tx.commit()?;
        return Ok(row);
    }

    let new_id = Uuid::new_v4().to_string();
    // Determine file size if not provided
    let computed_size: Option<i64> = match size {
        Some(s) if s > 0 => Some(s),
        _ => {
            match std::fs::metadata(path) {
                Ok(meta) => Some(meta.len() as i64),
                Err(_) => None,
            }
        }
    };
    tx.execute(
        "INSERT INTO files (id, path, name, type, size, chunk_count) VALUES (?1, ?2, ?3, ?4, ?5, 0)",
        params![new_id, path, name, file_type, computed_size],
    )?;

    let row: AttachmentFileInfo = {
        let mut stmt = tx.prepare(
            "SELECT id, path, name, type, size, chunk_count FROM files WHERE path = ?1",
        )?;
        stmt.query_row(params![path], |r| {
            Ok(AttachmentFileInfo {
                id: r.get(0)?,
                path: r.get(1)?,
                name: r.get(2)?,
                file_type: r.get(3)?,
                size: r.get(4)?,
                chunk_count: r.get(5)?,
            })
        })?
    };

    tx.commit()?;
    Ok(row)
}

pub fn insert_chunks(
    conn: &Connection,
    file_id: &str,
    chunks: Vec<MinimalChunkInput>,
    vec_loaded: bool,
) -> Result<(), VectorDBError> {
    let tx = conn.unchecked_transaction()?;

    // Check if vec table exists
    let has_vec = if vec_loaded {
        conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'")
            .and_then(|mut s| s.query_row([], |r| r.get::<_, String>(0)).optional())
            .ok()
            .flatten()
            .is_some()
    } else {
        false
    };

    // Determine current max order
    let mut current_order: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(chunk_file_order), -1) FROM chunks WHERE file_id = ?1",
            params![file_id],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(-1);

    for ch in chunks.into_iter() {
        current_order += 1;
        let emb = to_le_bytes_vec(&ch.embedding);
        let chunk_id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT OR REPLACE INTO chunks (id, text, embedding, file_id, chunk_file_order) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![chunk_id, ch.text, emb, file_id, current_order],
        )?;

        if has_vec {
            let rowid: i64 = tx
                .prepare("SELECT rowid FROM chunks WHERE id=?1")?
                .query_row(params![chunk_id], |r| r.get(0))?;
            let json_vec = serde_json::to_string(&ch.embedding).unwrap_or("[]".to_string());
            let _ = tx.execute(
                "INSERT OR REPLACE INTO chunks_vec(rowid, embedding) VALUES (?1, ?2)",
                params![rowid, json_vec],
            );
        }
    }

    // Update chunk_count
    let count: i64 = tx.query_row(
        "SELECT COUNT(*) FROM chunks WHERE file_id = ?1",
        params![file_id],
        |row| row.get(0),
    )?;
    tx.execute(
        "UPDATE files SET chunk_count = ?1 WHERE id = ?2",
        params![count, file_id],
    )?;

    tx.commit()?;
    Ok(())
}

pub fn delete_file(conn: &Connection, file_id: &str) -> Result<(), VectorDBError> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM chunks WHERE file_id = ?1", params![file_id])?;
    tx.execute("DELETE FROM files WHERE id = ?1", params![file_id])?;
    tx.commit()?;
    Ok(())
}

// ============================================================================
// Search Operations
// ============================================================================

pub fn search_collection(
    conn: &Connection,
    query_embedding: &[f32],
    limit: usize,
    threshold: f32,
    mode: Option<String>,
    vec_loaded: bool,
    file_ids: Option<Vec<String>>,
) -> Result<Vec<SearchResult>, VectorDBError> {
    let has_vec = if vec_loaded {
        conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'")
            .and_then(|mut s| s.query_row([], |r| r.get::<_, String>(0)).optional())
            .ok()
            .flatten()
            .is_some()
    } else {
        false
    };

    let prefer_ann = match mode.as_deref() {
        Some("ann") => true,
        Some("linear") => false,
        _ => true, // auto prefers ANN when available
    };

    if has_vec && prefer_ann {
        search_ann(conn, query_embedding, limit, file_ids)
    } else {
        search_linear(conn, query_embedding, limit, threshold, file_ids)
    }
}

fn search_ann(
    conn: &Connection,
    query_embedding: &[f32],
    limit: usize,
    file_ids: Option<Vec<String>>,
) -> Result<Vec<SearchResult>, VectorDBError> {
    let json_vec = serde_json::to_string(&query_embedding).unwrap_or("[]".to_string());

    // Build query with optional file_id filtering
    let query = if let Some(ref ids) = file_ids {
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        format!(
            "SELECT c.id, c.text, c.file_id, c.chunk_file_order, v.distance
             FROM chunks_vec v
             JOIN chunks c ON c.rowid = v.rowid
             WHERE v.embedding MATCH ?1 AND k = ?2 AND c.file_id IN ({})
             ORDER BY v.distance",
            placeholders
        )
    } else {
        "SELECT c.id, c.text, c.file_id, c.chunk_file_order, v.distance
         FROM chunks_vec v
         JOIN chunks c ON c.rowid = v.rowid
         WHERE v.embedding MATCH ?1 AND k = ?2
         ORDER BY v.distance".to_string()
    };

    let mut stmt = match conn.prepare(&query) {
        Ok(s) => s,
        Err(e) => {
            println!("[VectorDB] ✗ Failed to prepare ANN query: {}", e);
            return Err(e.into());
        }
    };

    let mut rows = if let Some(ids) = file_ids {
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![
            Box::new(json_vec),
            Box::new(limit as i64),
        ];
        for id in ids {
            params.push(Box::new(id));
        }
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        match stmt.query(&*param_refs) {
            Ok(r) => r,
            Err(e) => {
                println!("[VectorDB] ✗ Failed to execute ANN query: {}", e);
                return Err(e.into());
            }
        }
    } else {
        match stmt.query(params![json_vec, limit as i64]) {
            Ok(r) => r,
            Err(e) => {
                println!("[VectorDB] ✗ Failed to execute ANN query: {}", e);
                return Err(e.into());
            }
        }
    };

    let mut results = Vec::new();
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let text: String = row.get(1)?;
        let file_id: String = row.get(2)?;
        let chunk_file_order: i64 = row.get(3)?;
        let distance: f32 = row.get(4)?;

        results.push(SearchResult {
            id,
            text,
            score: Some(distance),
            file_id,
            chunk_file_order,
        });
    }

    println!("[VectorDB] ANN search returned {} results", results.len());
    Ok(results)
}

fn search_linear(
    conn: &Connection,
    query_embedding: &[f32],
    limit: usize,
    threshold: f32,
    file_ids: Option<Vec<String>>,
) -> Result<Vec<SearchResult>, VectorDBError> {
    let (query, params_vec): (String, Vec<Box<dyn rusqlite::ToSql>>) = if let Some(ids) = file_ids {
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let query_str = format!(
            "SELECT c.id, c.text, c.embedding, c.file_id, c.chunk_file_order
             FROM chunks c
             WHERE c.file_id IN ({})",
            placeholders
        );
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        for id in ids {
            params.push(Box::new(id));
        }
        (query_str, params)
    } else {
        (
            "SELECT c.id, c.text, c.embedding, c.file_id, c.chunk_file_order
             FROM chunks c".to_string(),
            Vec::new()
        )
    };

    let mut stmt = conn.prepare(&query)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    let mut rows = if param_refs.is_empty() {
        stmt.query([])?
    } else {
        stmt.query(&*param_refs)?
    };
    let mut results: Vec<SearchResult> = Vec::new();

    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let text: String = row.get(1)?;
        let embedding_bytes: Vec<u8> = row.get(2)?;
        let file_id: String = row.get(3)?;
        let chunk_file_order: i64 = row.get(4)?;

        let emb = from_le_bytes_vec(&embedding_bytes);
        let score = cosine_similarity(query_embedding, &emb)?;

        if score >= threshold {
            results.push(SearchResult {
                id,
                text,
                score: Some(score),
                file_id,
                chunk_file_order,
            });
        }
    }

    results.sort_by(|a, b| {
        match (b.score, a.score) {
            (Some(b_score), Some(a_score)) => b_score.partial_cmp(&a_score).unwrap_or(std::cmp::Ordering::Equal),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        }
    });
    let take: Vec<SearchResult> = results.into_iter().take(limit).collect();
    println!("[VectorDB] Linear search returned {} results", take.len());
    Ok(take)
}

// ============================================================================
// List Operations
// ============================================================================

pub fn list_attachments(
    conn: &Connection,
    limit: Option<usize>,
) -> Result<Vec<AttachmentFileInfo>, VectorDBError> {
    let query = if let Some(lim) = limit {
        format!("SELECT id, path, name, type, size, chunk_count FROM files LIMIT {}", lim)
    } else {
        "SELECT id, path, name, type, size, chunk_count FROM files".to_string()
    };

    let mut stmt = conn.prepare(&query)?;
    let mut rows = stmt.query([])?;
    let mut out = Vec::new();

    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let path: Option<String> = row.get(1)?;
        let name: Option<String> = row.get(2)?;
        let file_type: Option<String> = row.get(3)?;
        let size: Option<i64> = row.get(4)?;
        let chunk_count: i64 = row.get(5)?;
        out.push(AttachmentFileInfo {
            id,
            name,
            path,
            file_type,
            size,
            chunk_count,
        });
    }

    Ok(out)
}

// ============================================================================
// Delete Operations
// ============================================================================

pub fn delete_chunks(conn: &Connection, ids: Vec<String>) -> Result<(), VectorDBError> {
    let tx = conn.unchecked_transaction()?;
    for id in ids {
        tx.execute("DELETE FROM chunks WHERE id = ?1", params![id])?;
    }
    tx.commit()?;
    Ok(())
}

// ============================================================================
// Get Chunks by Order
// ============================================================================

pub fn get_chunks(
    conn: &Connection,
    file_id: String,
    start_order: i64,
    end_order: i64,
) -> Result<Vec<SearchResult>, VectorDBError> {
    let mut stmt = conn.prepare(
        "SELECT id, text, chunk_file_order FROM chunks
         WHERE file_id = ?1 AND chunk_file_order >= ?2 AND chunk_file_order <= ?3
         ORDER BY chunk_file_order"
    )?;
    let mut rows = stmt.query(params![&file_id, start_order, end_order])?;

    let mut results = Vec::new();
    while let Some(row) = rows.next()? {
        results.push(SearchResult {
            id: row.get(0)?,
            text: row.get(1)?,
            score: None,
            file_id: file_id.clone(),
            chunk_file_order: row.get(2)?,
        });
    }

    Ok(results)
}

// ============================================================================
// Utility Operations
// ============================================================================

pub fn chunk_text(text: String, chunk_size: usize, chunk_overlap: usize) -> Vec<String> {
    if chunk_size == 0 {
        return vec![];
    }

    let mut chunks = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut start = 0usize;

    while start < chars.len() {
        let end = (start + chunk_size).min(chars.len());
        let ch: String = chars[start..end].iter().collect();
        chunks.push(ch);
        if end >= chars.len() {
            break;
        }
        let advance = if chunk_overlap >= chunk_size {
            1
        } else {
            chunk_size - chunk_overlap
        };
        start += advance;
    }

    chunks
}

// ============================================================================
// Project-scoped agent memory (FTS5 / BM25)
// ============================================================================

/// Single global collection file holding all agent memories, isolated per
/// project via the `project_id` column.
pub const MEMORY_COLLECTION: &str = "__memory__";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MemoryHit {
    pub msg_id: String,
    pub project_id: String,
    pub text: String,
    pub role: String,
    pub ts: i64,
    pub score: f32,
}

/// FTS5 virtual table. `project_id` is UNINDEXED (filter column, not a search
/// term). Porter stemming + unicode61 folding for lexical recall.
pub fn ensure_memory_table(conn: &Connection) -> Result<(), VectorDBError> {
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS memories USING fts5(
            msg_id UNINDEXED,
            project_id UNINDEXED,
            text,
            role UNINDEXED,
            ts UNINDEXED,
            tokenize = 'porter unicode61'
        )",
        [],
    )?;
    Ok(())
}

/// Sanitize raw user text into a safe FTS5 MATCH expression: alphanumeric terms
/// (>=2 chars) quoted and OR-joined, so FTS5 operators in the input cannot raise
/// a syntax error. Returns None when nothing indexable remains.
fn build_fts_match(query: &str) -> Option<String> {
    let terms: Vec<String> = query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.chars().count() >= 2)
        .map(|t| format!("\"{}\"", t.to_lowercase()))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" OR "))
    }
}

/// Idempotent index: delete-then-insert by `msg_id`, so re-indexing an edited
/// message replaces its row instead of duplicating it.
pub fn memory_index(
    conn: &Connection,
    msg_id: &str,
    project_id: &str,
    text: &str,
    role: &str,
    ts: i64,
) -> Result<(), VectorDBError> {
    ensure_memory_table(conn)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM memories WHERE msg_id = ?1", params![msg_id])?;
    tx.execute(
        "INSERT INTO memories (msg_id, project_id, text, role, ts) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![msg_id, project_id, text, role, ts],
    )?;
    tx.commit()?;
    Ok(())
}

/// BM25-ranked recall scoped to a single project. Best match first (bm25 is more
/// negative = more relevant), recency breaks ties.
pub fn memory_search(
    conn: &Connection,
    project_id: &str,
    query: &str,
    top_k: usize,
) -> Result<Vec<MemoryHit>, VectorDBError> {
    ensure_memory_table(conn)?;
    let match_expr = match build_fts_match(query) {
        Some(m) => m,
        None => return Ok(Vec::new()),
    };
    let mut stmt = conn.prepare(
        "SELECT msg_id, project_id, text, role, ts, bm25(memories) AS score
         FROM memories
         WHERE project_id = ?1 AND memories MATCH ?2
         ORDER BY score ASC, ts DESC
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![project_id, match_expr, top_k as i64], |r| {
        Ok(MemoryHit {
            msg_id: r.get(0)?,
            project_id: r.get(1)?,
            text: r.get(2)?,
            role: r.get(3)?,
            ts: r.get(4)?,
            score: r.get::<_, f64>(5)? as f32,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Clear memories: a single project when `project_id` is given, else all.
pub fn memory_clear(conn: &Connection, project_id: Option<&str>) -> Result<(), VectorDBError> {
    ensure_memory_table(conn)?;
    match project_id {
        Some(pid) => conn.execute("DELETE FROM memories WHERE project_id = ?1", params![pid])?,
        None => conn.execute("DELETE FROM memories", [])?,
    };
    Ok(())
}

#[cfg(test)]
mod memory_tests {
    use super::*;

    fn mem_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");
        ensure_memory_table(&conn).expect("fts5 memory table");
        conn
    }

    #[test]
    fn bundled_sqlite_ships_fts5() {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");
        conn.execute(
            "CREATE VIRTUAL TABLE t USING fts5(content)",
            [],
        )
        .expect("bundled rusqlite must ship FTS5");
    }

    #[test]
    fn index_and_bm25_recall() {
        let conn = mem_conn();
        memory_index(&conn, "m1", "p1", "the quick brown fox jumps", "user", 100).unwrap();
        memory_index(&conn, "m2", "p1", "lazy dogs sleep all day", "user", 200).unwrap();

        let hits = memory_search(&conn, "p1", "brown fox", 5).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].msg_id, "m1");
    }

    #[test]
    fn reindex_by_msg_id_is_idempotent() {
        let conn = mem_conn();
        memory_index(&conn, "m1", "p1", "original text about apples", "user", 100).unwrap();
        memory_index(&conn, "m1", "p1", "revised text about oranges", "user", 150).unwrap();

        assert!(memory_search(&conn, "p1", "apples", 5).unwrap().is_empty());
        let hits = memory_search(&conn, "p1", "oranges", 5).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].text, "revised text about oranges");
    }

    #[test]
    fn search_is_project_isolated() {
        let conn = mem_conn();
        memory_index(&conn, "a", "projectA", "shared keyword alpha", "user", 100).unwrap();
        memory_index(&conn, "b", "projectB", "shared keyword alpha", "user", 100).unwrap();

        let hits = memory_search(&conn, "projectA", "keyword", 5).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].project_id, "projectA");
    }

    #[test]
    fn recency_breaks_score_ties() {
        let conn = mem_conn();
        memory_index(&conn, "old", "p1", "duplicate phrase here", "user", 100).unwrap();
        memory_index(&conn, "new", "p1", "duplicate phrase here", "user", 200).unwrap();

        let hits = memory_search(&conn, "p1", "duplicate phrase", 5).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].msg_id, "new");
    }

    #[test]
    fn operator_injection_is_safe() {
        let conn = mem_conn();
        memory_index(&conn, "m1", "p1", "normal indexed content", "user", 100).unwrap();
        // Raw FTS5 operators in the query must not raise a syntax error.
        let hits = memory_search(&conn, "p1", "content AND (OR* NEAR/2 \"", 5).unwrap();
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn clear_all_and_per_project() {
        let conn = mem_conn();
        memory_index(&conn, "a", "p1", "content one", "user", 100).unwrap();
        memory_index(&conn, "b", "p2", "content two", "user", 100).unwrap();

        memory_clear(&conn, Some("p1")).unwrap();
        assert!(memory_search(&conn, "p1", "content", 5).unwrap().is_empty());
        assert_eq!(memory_search(&conn, "p2", "content", 5).unwrap().len(), 1);

        memory_clear(&conn, None).unwrap();
        assert!(memory_search(&conn, "p2", "content", 5).unwrap().is_empty());
    }
}
