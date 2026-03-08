use crate::{VectorDBError, VectorDBState};
use crate::db::{
    self, AttachmentFileInfo, SearchResult, MinimalChunkInput,
};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct Status {
    pub ann_available: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInput {
    pub path: String,
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub file_type: Option<String>,
    pub size: Option<i64>,
}

// ============================================================================
// Tauri Command Handlers
// ============================================================================

#[tauri::command]
pub async fn get_status(state: State<'_, VectorDBState>) -> Result<Status, VectorDBError> {
    println!("[VectorDB] Checking ANN availability...");
    let temp = db::collection_path(&state.base_dir, "__status__");
    let conn = db::open_or_init_conn(&temp)?;

    // Verbose version for startup diagnostics
    let ann = {
        if conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS temp.temp_vec USING vec0(embedding float[1])", []).is_ok() {
            let _ = conn.execute("DROP TABLE IF EXISTS temp.temp_vec", []);
            println!("[VectorDB] ✓ sqlite-vec already loaded");
            true
        } else {
            unsafe { let _ = conn.load_extension_enable(); }
            let paths = db::possible_sqlite_vec_paths();
            println!("[VectorDB] Trying {} bundled paths...", paths.len());
            let mut found = false;
            for p in paths {
                println!("[VectorDB]   Trying: {}", p);
                unsafe {
                    if let Ok(_) = conn.load_extension(&p, Some("sqlite3_vec_init")) {
                        if conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS temp.temp_vec USING vec0(embedding float[1])", []).is_ok() {
                            let _ = conn.execute("DROP TABLE IF EXISTS temp.temp_vec", []);
                            println!("[VectorDB] ✓ sqlite-vec loaded from: {}", p);
                            found = true;
                            break;
                        }
                    }
                }
            }
            if !found {
                println!("[VectorDB] ✗ Failed to load sqlite-vec from all paths");
            }
            found
        }
    };

    println!("[VectorDB] ANN status: {}", if ann { "AVAILABLE ✓" } else { "NOT AVAILABLE ✗" });
    Ok(Status { ann_available: ann })
}

#[tauri::command]
pub async fn create_collection<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    state: State<'_, VectorDBState>,
    name: String,
    dimension: usize,
) -> Result<(), VectorDBError> {
    let path = db::collection_path(&state.base_dir, &name);
    let conn = db::open_or_init_conn(&path)?;

    let has_ann = db::create_schema(&conn, dimension)?;
    if has_ann {
        println!("[VectorDB] ✓ Collection '{}' created with ANN support", name);
    } else {
        println!("[VectorDB] ⚠ Collection '{}' created WITHOUT ANN support (will use linear search)", name);
    }
    Ok(())
}

#[tauri::command]
pub async fn create_file<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    state: State<'_, VectorDBState>,
    collection: String,
    file: FileInput,
) -> Result<AttachmentFileInfo, VectorDBError> {
    let path = db::collection_path(&state.base_dir, &collection);
    let conn = db::open_or_init_conn(&path)?;
    db::create_file(
        &conn,
        &file.path,
        file.name.as_deref(),
        file.file_type.as_deref(),
        file.size,
    )
}

#[tauri::command]
pub async fn insert_chunks<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    state: State<'_, VectorDBState>,
    collection: String,
    file_id: String,
    chunks: Vec<MinimalChunkInput>,
) -> Result<(), VectorDBError> {
    let path = db::collection_path(&state.base_dir, &collection);
    let conn = db::open_or_init_conn(&path)?;
    let vec_loaded = db::try_load_sqlite_vec(&conn);
    db::insert_chunks(&conn, &file_id, chunks, vec_loaded)
}

#[tauri::command]
pub async fn delete_file<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    state: State<'_, VectorDBState>,
    collection: String,
    file_id: String,
) -> Result<(), VectorDBError> {
    let path = db::collection_path(&state.base_dir, &collection);
    let conn = db::open_or_init_conn(&path)?;
    db::delete_file(&conn, &file_id)
}

#[tauri::command]
pub async fn search_collection<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    state: State<'_, VectorDBState>,
    collection: String,
    query_embedding: Vec<f32>,
    limit: usize,
    threshold: f32,
    mode: Option<String>,
    file_ids: Option<Vec<String>>,
) -> Result<Vec<SearchResult>, VectorDBError> {
    let path = db::collection_path(&state.base_dir, &collection);
    let conn = db::open_or_init_conn(&path)?;
    let vec_loaded = db::try_load_sqlite_vec(&conn);
    db::search_collection(&conn, &query_embedding, limit, threshold, mode, vec_loaded, file_ids)
}

#[tauri::command]
pub async fn list_attachments<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    state: State<'_, VectorDBState>,
    collection: String,
    limit: Option<usize>,
) -> Result<Vec<AttachmentFileInfo>, VectorDBError> {
    let path = db::collection_path(&state.base_dir, &collection);
    let conn = db::open_or_init_conn(&path)?;
    db::list_attachments(&conn, limit)
}

#[tauri::command]
pub async fn delete_chunks<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    state: State<'_, VectorDBState>,
    collection: String,
    ids: Vec<String>,
) -> Result<(), VectorDBError> {
    let path = db::collection_path(&state.base_dir, &collection);
    let conn = db::open_or_init_conn(&path)?;
    db::delete_chunks(&conn, ids)
}

#[tauri::command]
pub async fn delete_collection<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    state: State<'_, VectorDBState>,
    collection: String,
) -> Result<(), VectorDBError> {
    let path = db::collection_path(&state.base_dir, &collection);
    if path.exists() {
        std::fs::remove_file(path).ok();
    }
    Ok(())
}

#[tauri::command]
pub async fn chunk_text<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    text: String,
    chunk_size: usize,
    chunk_overlap: usize,
) -> Result<Vec<String>, VectorDBError> {
    Ok(db::chunk_text(text, chunk_size, chunk_overlap))
}

#[tauri::command]
pub async fn get_chunks<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    state: State<'_, VectorDBState>,
    collection: String,
    file_id: String,
    start_order: i64,
    end_order: i64,
) -> Result<Vec<SearchResult>, VectorDBError> {
    let path = db::collection_path(&state.base_dir, &collection);
    let conn = db::open_or_init_conn(&path)?;
    db::get_chunks(&conn, file_id, start_order, end_order)
}
