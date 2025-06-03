use anyhow::{Result, anyhow};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use serde_json::Value;
use chrono::{DateTime, Utc};
use lancedb::{Connection, query::{ExecutableQuery, QueryBase}};
use arrow_array::{RecordBatch, RecordBatchIterator, StringArray, UInt64Array, Int32Array, Array};
use arrow_schema::{Schema, Field, DataType};
use futures_util::TryStreamExt;

use super::types::{SourceInfo, DocumentChunk, QueryResult};

/// Database operations for RAG system using LanceDB
pub struct RAGDatabase {
    connection: Arc<Mutex<Option<Connection>>>,
    sources_table_name: String,
    chunks_table_name: String,
    db_path: Arc<Mutex<Option<PathBuf>>>,
}

impl RAGDatabase {
    pub fn new() -> Self {
        Self {
            connection: Arc::new(Mutex::new(None)),
            sources_table_name: "rag_sources".to_string(),
            chunks_table_name: "rag_chunks".to_string(),
            db_path: Arc::new(Mutex::new(None)),
        }
    }

    /// Initialize the database connection and create tables
    pub async fn initialize(&mut self, db_path: Option<PathBuf>) -> Result<()> {
        let db_uri = match db_path.clone() {
            Some(path) => path.to_string_lossy().to_string(),
            None => {
                let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
                home_dir.join(".jan").join("rag_db").to_string_lossy().to_string()
            }
        };

        *self.db_path.lock().await = db_path;

        // Create directory if it doesn't exist
        if let Some(parent) = PathBuf::from(&db_uri).parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        // Initialize LanceDB connection
        let conn = lancedb::connect(&db_uri).execute().await?;
        
        // Create tables if they don't exist
        self.create_tables(&conn).await?;
        
        // Store connection
        *self.connection.lock().await = Some(conn);

        log::info!("RAG database initialized at: {}", db_uri);
        Ok(())
    }

    /// Get database status
    pub async fn get_status(&self) -> Result<String> {
        let conn_guard = self.connection.lock().await;
        match conn_guard.as_ref() {
            Some(_) => {
                let db_path_guard = self.db_path.lock().await;
                let path_str = match db_path_guard.as_ref() {
                    Some(path) => path.to_string_lossy().to_string(),
                    None => "default".to_string(),
                };
                Ok(format!("Database initialized at: {}", path_str))
            }
            None => Ok("Database not initialized".to_string()),
        }
    }

    /// Store source information
    pub async fn store_source(&self, source: &SourceInfo) -> Result<()> {
        let conn_guard = self.connection.lock().await;
        let conn = conn_guard.as_ref()
            .ok_or_else(|| anyhow!("Database connection not initialized"))?;
        
        let table = conn.open_table(&self.sources_table_name).execute().await
            .map_err(|e| anyhow!("Failed to open sources table: {}", e))?;
        
        // Convert source info to arrow arrays
        let batch = self.create_source_record_batch(source, &table.schema().await?)?;
        
        // Add to table
        let reader = RecordBatchIterator::new(vec![Ok(batch)], table.schema().await?);
        table.add(reader).execute().await
            .map_err(|e| anyhow!("Failed to add source to table: {}", e))?;
        
        log::info!("Successfully stored source: {}", source.id);
        Ok(())
    }

    /// Store document chunks
    pub async fn store_chunks(&self, chunks: &[DocumentChunk], embedding_dim: usize) -> Result<()> {
        if chunks.is_empty() {
            log::warn!("No chunks to store");
            return Ok(());
        }

        let conn_guard = self.connection.lock().await;
        let conn = conn_guard.as_ref()
            .ok_or_else(|| anyhow!("Database connection not initialized"))?;
        
        // Try to open table, create it if it doesn't exist
        let (table, table_was_created) = match conn.open_table(&self.chunks_table_name).execute().await {
            Ok(table) => (table, false),
            Err(_) => {
                log::info!("Creating chunks table with dimension: {}", embedding_dim);
                let table = self.create_chunks_table(conn, chunks, embedding_dim).await?;
                (table, true)
            }
        };
        
        // Determine which chunks to add
        let chunks_to_add = if table_was_created && chunks.len() > 1 {
            &chunks[1..] // Skip first chunk used to create table
        } else {
            chunks
        };
        
        if !chunks_to_add.is_empty() {
            let schema = table.schema().await?;
            let batch = self.create_chunks_record_batch(chunks_to_add, &schema)?;
            let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
            
            table.add(reader).execute().await
                .map_err(|e| anyhow!("Failed to add chunks to table: {}", e))?;
            
            // Create vector index if we have enough data
            self.create_vector_index_if_needed(&table).await?;
        }
        
        log::info!("Successfully stored {} chunks", chunks.len());
        Ok(())
    }

    /// List all data sources
    pub async fn list_sources(&self) -> Result<Vec<SourceInfo>> {
        let conn_guard = self.connection.lock().await;
        let conn = conn_guard.as_ref()
            .ok_or_else(|| anyhow!("Database not initialized"))?;
        
        let table = conn.open_table(&self.sources_table_name).execute().await
            .map_err(|e| anyhow!("Failed to open sources table: {}", e))?;
        
        let batches = table
            .query()
            .limit(1000)
            .execute()
            .await?
            .try_collect::<Vec<_>>()
            .await?;
        
        let mut sources = Vec::new();
        for batch in batches {
            sources.extend(self.parse_source_batch(&batch)?);
        }
        
        log::info!("Retrieved {} sources from database", sources.len());
        Ok(sources)
    }

    /// Remove a data source and its chunks
    pub async fn remove_source(&self, source_id: &str) -> Result<bool> {
        let conn_guard = self.connection.lock().await;
        let conn = conn_guard.as_ref()
            .ok_or_else(|| anyhow!("Database not initialized"))?;
        
        let mut removed = false;
        
        // Remove from sources table
        if let Ok(table) = conn.open_table(&self.sources_table_name).execute().await {
            if table.delete(&format!("id = '{}'", source_id)).await.is_ok() {
                removed = true;
            }
        }
        
        // Remove chunks from chunks table
        if let Ok(table) = conn.open_table(&self.chunks_table_name).execute().await {
            let _ = table.delete(&format!("source_id = '{}'", source_id)).await;
        }
        
        log::info!("Removed source: {} (success: {})", source_id, removed);
        Ok(removed)
    }

    /// Query chunks using vector similarity search
    pub async fn query_chunks(
        &self,
        query_embedding: Vec<f32>,
        top_k: usize,
        filters: Option<HashMap<String, String>>,
    ) -> Result<Vec<QueryResult>> {
        let conn_guard = self.connection.lock().await;
        let conn = conn_guard.as_ref()
            .ok_or_else(|| anyhow!("Database not initialized"))?;
        
        let table = conn.open_table(&self.chunks_table_name).execute().await
            .map_err(|_| anyhow!("No chunks table found. Please add documents first."))?;
        
        // Check if table has data
        let count = table.count_rows(None).await?;
        if count == 0 {
            log::warn!("No documents in chunks table");
            return Ok(Vec::new());
        }
        
        // Build vector query
        let mut query_builder = table
            .query()
            .nearest_to(query_embedding)?
            .column("vector")
            .limit(top_k);
        
        // Apply filters
        if let Some(filters_map) = &filters {
            if let Some(filter_source_id) = filters_map.get("source_id") {
                query_builder = query_builder.only_if(format!("source_id = '{}'", filter_source_id));
            }
        }
        
        // Execute query
        let batches = query_builder.execute().await?.try_collect::<Vec<_>>().await?;
        
        let mut results = Vec::new();
        for batch in batches {
            results.extend(self.parse_query_batch(&batch)?);
        }
        
        log::info!("Vector search returned {} results", results.len());
        Ok(results)
    }

    /// Clean all data sources
    pub async fn clean_all(&self) -> Result<()> {
        let conn_guard = self.connection.lock().await;
        let conn = conn_guard.as_ref()
            .ok_or_else(|| anyhow!("Database not initialized"))?;
        
        // Drop tables if they exist
        if conn.open_table(&self.sources_table_name).execute().await.is_ok() {
            conn.drop_table(&self.sources_table_name).await?;
        }
        
        if conn.open_table(&self.chunks_table_name).execute().await.is_ok() {
            conn.drop_table(&self.chunks_table_name).await?;
        }
        
        // Recreate tables
        self.create_tables(conn).await?;
        
        log::info!("Database cleaned and tables recreated");
        Ok(())
    }

    // Private helper methods
    
    async fn create_tables(&self, conn: &Connection) -> Result<()> {
        self.create_sources_table(conn).await?;
        log::info!("Chunks table will be created when first document is added");
        Ok(())
    }

    async fn create_sources_table(&self, conn: &Connection) -> Result<()> {
        if conn.open_table(&self.sources_table_name).execute().await.is_ok() {
            log::info!("Sources table already exists");
            return Ok(());
        }

        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Utf8, false),
            Field::new("source_id", DataType::Utf8, false),
            Field::new("type", DataType::Utf8, false),
            Field::new("name", DataType::Utf8, false),
            Field::new("path", DataType::Utf8, false),
            Field::new("filename", DataType::Utf8, false),
            Field::new("file_type", DataType::Utf8, false),
            Field::new("status", DataType::Utf8, false),
            Field::new("created_at", DataType::Utf8, false),
            Field::new("updated_at", DataType::Utf8, false),
            Field::new("added_at", DataType::Utf8, false),
            Field::new("metadata", DataType::Utf8, true),
            Field::new("chunk_count", DataType::UInt64, false),
            Field::new("file_size", DataType::UInt64, false),
            Field::new("error_message", DataType::Utf8, true),
        ]));
        
        let empty_batch = RecordBatch::new_empty(schema.clone());
        let reader = RecordBatchIterator::new(vec![Ok(empty_batch)], schema);
        
        conn.create_table(&self.sources_table_name, reader).execute().await?;
        log::info!("Sources table created successfully");
        Ok(())
    }

    async fn create_chunks_table(&self, conn: &Connection, chunks: &[DocumentChunk], embedding_dim: usize) -> Result<lancedb::Table> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Utf8, false),
            Field::new("source_id", DataType::Utf8, false),
            Field::new("text_chunk", DataType::Utf8, false),
            Field::new("vector", DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, false)), 
                embedding_dim as i32
            ), false),
            Field::new("original_document_path", DataType::Utf8, false),
            Field::new("document_type", DataType::Utf8, false),
            Field::new("chunk_order", DataType::Int32, false),
        ]));
        
        // Create table with first chunk
        let initial_batch = self.create_chunks_record_batch(&chunks[0..1], &schema)?;
        let reader = RecordBatchIterator::new(vec![Ok(initial_batch)], schema);
        
        conn.create_table(&self.chunks_table_name, reader).execute().await?;
        
        let table = conn.open_table(&self.chunks_table_name).execute().await?;
        log::info!("Chunks table created successfully");
        Ok(table)
    }

    async fn create_vector_index_if_needed(&self, table: &lancedb::Table) -> Result<()> {
        let row_count = table.count_rows(None).await.unwrap_or(0);
        if row_count >= 256 {
            match table.create_index(&["vector"], lancedb::index::Index::IvfPq(Default::default())).execute().await {
                Ok(_) => log::info!("Vector index created successfully"),
                Err(e) if e.to_string().contains("already exists") => {
                    log::debug!("Vector index already exists");
                }
                Err(e) => log::warn!("Failed to create vector index: {}", e),
            }
        }
        Ok(())
    }

    fn create_source_record_batch(&self, source: &SourceInfo, schema: &Arc<Schema>) -> Result<RecordBatch> {
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![source.id.clone()])),
                Arc::new(StringArray::from(vec![source.source_id.clone()])),
                Arc::new(StringArray::from(vec![source.r#type.clone()])),
                Arc::new(StringArray::from(vec![source.name.clone()])),
                Arc::new(StringArray::from(vec![source.path.clone()])),
                Arc::new(StringArray::from(vec![source.filename.clone()])),
                Arc::new(StringArray::from(vec![source.file_type.clone()])),
                Arc::new(StringArray::from(vec![source.status.clone()])),
                Arc::new(StringArray::from(vec![source.created_at.to_rfc3339()])),
                Arc::new(StringArray::from(vec![source.updated_at.to_rfc3339()])),
                Arc::new(StringArray::from(vec![source.added_at.to_rfc3339()])),
                Arc::new(StringArray::from(vec![source.metadata.as_ref()
                    .map(|m| serde_json::to_string(m).unwrap_or_default())
                    .as_deref()])),
                Arc::new(UInt64Array::from(vec![source.chunk_count as u64])),
                Arc::new(UInt64Array::from(vec![source.file_size])),
                Arc::new(StringArray::from(vec![source.error_message.as_deref()])),
            ],
        )?;
        Ok(batch)
    }

    fn create_chunks_record_batch(&self, chunks: &[DocumentChunk], schema: &Arc<Schema>) -> Result<RecordBatch> {
        if chunks.is_empty() {
            return Err(anyhow!("No chunks provided"));
        }

        let expected_dim = chunks[0].vector.len();
        
        // Prepare arrays
        let ids: Vec<String> = chunks.iter().map(|c| c.id.clone()).collect();
        let source_ids: Vec<String> = chunks.iter().map(|c| c.source_id.clone()).collect();
        let text_chunks: Vec<String> = chunks.iter().map(|c| c.text_chunk.clone()).collect();
        let original_paths: Vec<String> = chunks.iter().map(|c| c.original_document_path.clone()).collect();
        let doc_types: Vec<String> = chunks.iter().map(|c| c.document_type.clone()).collect();
        let chunk_orders: Vec<i32> = chunks.iter().map(|c| c.chunk_order).collect();
        
        // Create vector array
        let mut vector_values = Vec::new();
        for chunk in chunks {
            if chunk.vector.len() != expected_dim {
                return Err(anyhow!("Vector dimension mismatch"));
            }
            vector_values.extend_from_slice(&chunk.vector);
        }
        
        let values_array = arrow_array::Float32Array::from(vector_values);
        
        // Get the actual vector field from the schema to ensure type compatibility
        let vector_field = schema.field_with_name("vector")
            .map_err(|e| anyhow!("Vector field not found in schema: {}", e))?;
        
        let vectors = match vector_field.data_type() {
            DataType::FixedSizeList(inner_field, size) => {
                // Use the exact field definition from the schema to maintain nullability compatibility
                arrow_array::FixedSizeListArray::try_new(
                    inner_field.clone(),
                    *size,
                    Arc::new(values_array),
                    None
                )?
            }
            _ => return Err(anyhow!("Invalid vector field type in schema")),
        };
        
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(ids)),
                Arc::new(StringArray::from(source_ids)),
                Arc::new(StringArray::from(text_chunks)),
                Arc::new(vectors),
                Arc::new(StringArray::from(original_paths)),
                Arc::new(StringArray::from(doc_types)),
                Arc::new(Int32Array::from(chunk_orders)),
            ],
        )?;
        
        Ok(batch)
    }

    fn parse_source_batch(&self, batch: &RecordBatch) -> Result<Vec<SourceInfo>> {
        let mut sources = Vec::new();
        
        // Get all required columns
        let id_array = batch.column_by_name("id")
            .and_then(|col| col.as_any().downcast_ref::<StringArray>())
            .ok_or_else(|| anyhow!("Missing or invalid id column"))?;
        let source_id_array = batch.column_by_name("source_id")
            .and_then(|col| col.as_any().downcast_ref::<StringArray>())
            .ok_or_else(|| anyhow!("Missing or invalid source_id column"))?;
        let type_array = batch.column_by_name("type")
            .and_then(|col| col.as_any().downcast_ref::<StringArray>())
            .ok_or_else(|| anyhow!("Missing or invalid type column"))?;
        let name_array = batch.column_by_name("name")
            .and_then(|col| col.as_any().downcast_ref::<StringArray>())
            .ok_or_else(|| anyhow!("Missing or invalid name column"))?;
        let path_array = batch.column_by_name("path")
            .and_then(|col| col.as_any().downcast_ref::<StringArray>())
            .ok_or_else(|| anyhow!("Missing or invalid path column"))?;
        let filename_array = batch.column_by_name("filename")
            .and_then(|col| col.as_any().downcast_ref::<StringArray>())
            .ok_or_else(|| anyhow!("Missing or invalid filename column"))?;
        let file_type_array = batch.column_by_name("file_type")
            .and_then(|col| col.as_any().downcast_ref::<StringArray>())
            .ok_or_else(|| anyhow!("Missing or invalid file_type column"))?;
        let status_array = batch.column_by_name("status")
            .and_then(|col| col.as_any().downcast_ref::<StringArray>())
            .ok_or_else(|| anyhow!("Missing or invalid status column"))?;
        let created_at_array = batch.column_by_name("created_at")
            .and_then(|col| col.as_any().downcast_ref::<StringArray>())
            .ok_or_else(|| anyhow!("Missing or invalid created_at column"))?;
        let updated_at_array = batch.column_by_name("updated_at")
            .and_then(|col| col.as_any().downcast_ref::<StringArray>())
            .ok_or_else(|| anyhow!("Missing or invalid updated_at column"))?;
        let added_at_array = batch.column_by_name("added_at")
            .and_then(|col| col.as_any().downcast_ref::<StringArray>())
            .ok_or_else(|| anyhow!("Missing or invalid added_at column"))?;
        
        // Optional columns
        let chunk_count_array = batch.column_by_name("chunk_count")
            .and_then(|col| col.as_any().downcast_ref::<Int32Array>());
        let file_size_array = batch.column_by_name("file_size")
            .and_then(|col| col.as_any().downcast_ref::<UInt64Array>());
        let metadata_array = batch.column_by_name("metadata")
            .and_then(|col| col.as_any().downcast_ref::<StringArray>());
        let error_message_array = batch.column_by_name("error_message")
            .and_then(|col| col.as_any().downcast_ref::<StringArray>());
        
        for i in 0..batch.num_rows() {
            let created_at = self.parse_datetime(created_at_array.value(i));
            let updated_at = self.parse_datetime(updated_at_array.value(i));
            let added_at = self.parse_datetime(added_at_array.value(i));
            
            let metadata = metadata_array
                .and_then(|arr| serde_json::from_str(arr.value(i)).ok());
            
            sources.push(SourceInfo {
                id: id_array.value(i).to_string(),
                source_id: source_id_array.value(i).to_string(),
                r#type: type_array.value(i).to_string(),
                name: name_array.value(i).to_string(),
                path: path_array.value(i).to_string(),
                filename: filename_array.value(i).to_string(),
                file_type: file_type_array.value(i).to_string(),
                status: status_array.value(i).to_string(),
                created_at,
                updated_at,
                added_at,
                metadata,
                chunk_count: chunk_count_array.map(|arr| arr.value(i) as usize).unwrap_or(0),
                file_size: file_size_array.map(|arr| arr.value(i)).unwrap_or(0),
                error_message: error_message_array
                    .and_then(|arr| {
                        let value = arr.value(i);
                        if value.is_empty() { None } else { Some(value.to_string()) }
                    }),
            });
        }
        
        Ok(sources)
    }

    fn parse_query_batch(&self, batch: &RecordBatch) -> Result<Vec<QueryResult>> {
        let mut results = Vec::new();
        
        let id_array = batch.column_by_name("id")
            .and_then(|col| col.as_any().downcast_ref::<StringArray>())
            .ok_or_else(|| anyhow!("Missing or invalid id column"))?;
        let source_id_array = batch.column_by_name("source_id")
            .and_then(|col| col.as_any().downcast_ref::<StringArray>())
            .ok_or_else(|| anyhow!("Missing or invalid source_id column"))?;
        let text_chunk_array = batch.column_by_name("text_chunk")
            .and_then(|col| col.as_any().downcast_ref::<StringArray>())
            .ok_or_else(|| anyhow!("Missing or invalid text_chunk column"))?;
        let distance_array = batch.column_by_name("_distance")
            .and_then(|col| col.as_any().downcast_ref::<arrow_array::Float32Array>())
            .ok_or_else(|| anyhow!("Missing _distance column"))?;
        
        for i in 0..batch.num_rows() {
            let distance = distance_array.value(i);
            let score = 1.0 / (1.0 + distance); // Convert distance to similarity score
            
            let mut metadata = HashMap::new();
            metadata.insert("source_id".to_string(), Value::String(source_id_array.value(i).to_string()));
            
            // Add optional metadata fields
            if let Some(path_array) = batch.column_by_name("original_document_path")
                .and_then(|col| col.as_any().downcast_ref::<StringArray>()) {
                metadata.insert("original_document_path".to_string(),
                    Value::String(path_array.value(i).to_string()));
            }
            
            if let Some(type_array) = batch.column_by_name("document_type")
                .and_then(|col| col.as_any().downcast_ref::<StringArray>()) {
                metadata.insert("document_type".to_string(),
                    Value::String(type_array.value(i).to_string()));
            }
            
            if let Some(order_array) = batch.column_by_name("chunk_order")
                .and_then(|col| col.as_any().downcast_ref::<Int32Array>()) {
                metadata.insert("chunk_order".to_string(),
                    Value::Number(serde_json::Number::from(order_array.value(i))));
            }
            
            results.push(QueryResult {
                content: text_chunk_array.value(i).to_string(),
                source_id: source_id_array.value(i).to_string(),
                score,
                chunk_id: id_array.value(i).to_string(),
                metadata: Some(metadata),
            });
        }
        
        Ok(results)
    }

    fn parse_datetime(&self, datetime_str: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(datetime_str)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now())
    }
}