# Jan Plugin RAG

A powerful Jan plugin for Retrieval-Augmented Generation (RAG) functionality with vector database support, document processing, and Model Context Protocol (MCP) integration.

## Features

- 🔍 **Vector Search**: LanceDB-powered semantic search with customizable embeddings
- 📄 **Document Processing**: Support for PDF, DOCX, TXT, MD, HTML, CSV, and JSON files
- 🧩 **Text Chunking**: Configurable text segmentation with overlap support
- 🤖 **Embeddings**: Flexible embedding generation with multiple model support
- 🔗 **MCP Integration**: Built-in Model Context Protocol support for external clients
- ⚙️ **Configurable**: Extensive configuration options for all components
- 🔒 **Secure**: Proper permission system and secure file handling
- 📱 **Cross-Platform**: Works on desktop and mobile platforms

## Installation

Add the plugin to your `Cargo.toml`:

```toml
[dependencies]
jan-plugin-rag = "2.0.0"
# alternatively with Git:
jan-plugin-rag = { git = "https://github.com/menloresearch/jan", branch = "main" }
```

Install the JavaScript guest bindings:

```bash
pnpm add @janhq/plugin-rag
# or
npm add @janhq/plugin-rag
# or
yarn add @janhq/plugin-rag
```

## Usage

### Rust Backend

#### Basic Usage

```rust
use jan_plugin_rag;

fn main() {
    tauri::Builder::default()
        .plugin(jan_plugin_rag::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### With Custom Configuration

```rust
use jan_plugin_rag::{init_with_config, RAGConfig, EmbeddingConfig, ChunkingConfig};

fn main() {
    let config = RAGConfig {
        embedding_config: EmbeddingConfig {
            base_url: "http://localhost:11434".to_string(),
            api_key: None,
            model: "nomic-embed-text".to_string(),
            dimensions: 768,
        },
        chunking_config: ChunkingConfig {
            chunk_size: 1000,
            overlap: 100,
        },
        database_path: None, // Uses app data directory
        auto_initialize: true,
    };

    tauri::Builder::default()
        .plugin(init_with_config(config))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### With MCP Integration

```rust
use jan_plugin_rag::{init_with_config_and_mcp, RAGConfig, EmbeddingConfig};

fn main() {
    let config = RAGConfig {
        embedding_config: EmbeddingConfig {
            base_url: "http://localhost:11434".to_string(),
            api_key: None,
            model: "nomic-embed-text".to_string(),
            dimensions: 768,
        },
        // ... other config
        chunking_config: Default::default(),
        database_path: None,
        auto_initialize: true,
    };

    tauri::Builder::default()
        .plugin(init_with_config_and_mcp(config))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### Using the Builder Pattern

```rust
use jan_plugin_rag::{Builder, RAGConfig, EmbeddingConfig};

fn main() {
    let config = RAGConfig::default();

    tauri::Builder::default()
        .plugin(
            Builder::new()
                .with_config(config)
                .enable_mcp()
                .build()
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### JavaScript Frontend

```typescript
import {
  initializeRAG,
  addDataSource,
  queryDocuments,
  listDataSources,
  removeDataSource,
  getRAGStatus,
} from '@janhq/plugin-rag'

// Initialize the RAG system
await initializeRAG()

// Add a document
const result = await addDataSource({
  sourceType: 'file',
  pathOrUrl: '/path/to/document.pdf',
  content: '', // For files, content can be empty
  metadata: { author: 'John Doe', category: 'research' },
})

// Query documents
const queryResult = await queryDocuments({
  query: 'What is machine learning?',
  topK: 5,
  filters: { category: 'research' },
})

// List all data sources
const sources = await listDataSources()

// Get system status
const status = await getRAGStatus()
```

### MCP Integration

The plugin provides MCP tools that can be used by external clients:

- `rag_initialize`: Initialize the RAG system
- `rag_add_data_source`: Add documents to the knowledge base
- `rag_query_documents`: Search for relevant document chunks
- `rag_list_data_sources`: List all indexed documents
- `rag_remove_data_source`: Remove documents from the knowledge base
- `rag_clean_all_data_sources`: Clear all indexed data
- `rag_get_status`: Get system status and statistics

## Configuration

### RAGConfig

```rust
pub struct RAGConfig {
    pub embedding_config: EmbeddingConfig,
    pub chunking_config: ChunkingConfig,
    pub database_path: Option<PathBuf>,
    pub auto_initialize: bool,
}
```

### EmbeddingConfig

```rust
pub struct EmbeddingConfig {
    pub base_url: String,      // Embedding API base URL
    pub api_key: Option<String>, // Optional API key
    pub model: String,         // Model name (e.g., "nomic-embed-text")
    pub dimensions: usize,     // Vector dimensions
}
```

### ChunkingConfig

```rust
pub struct ChunkingConfig {
    pub chunk_size: usize,     // Size of text chunks
    pub overlap: usize,        // Overlap between chunks
}
```

## Permissions

Add the following permissions to your `capabilities/default.json`:

```json
{
  "permissions": [
    "rag:default",
    "rag:allow-add-data-source",
    "rag:allow-query-documents",
    "rag:allow-list-data-sources",
    "rag:allow-remove-data-source"
  ]
}
```

## Supported File Types

- PDF (`.pdf`)
- Microsoft Word (`.docx`)
- Text files (`.txt`)
- Markdown (`.md`)
- HTML (`.html`)
- CSV (`.csv`)
- JSON (`.json`)

## Migration from Existing RAG Implementation

If you're migrating from an existing RAG implementation in your Tauri app:

1. **Remove existing RAG code** from your `src-tauri/src/core/rag/` directory
2. **Add the plugin** to your `Cargo.toml`
3. **Update your main.rs** to use the plugin instead of direct RAG system initialization
4. **Update frontend calls** to use the plugin's JavaScript bindings
5. **Configure permissions** in your capabilities file

### Before (Direct Implementation)

```rust
// src-tauri/src/main.rs
use crate::core::rag::{initialize_rag_system_with_app, RAGSystem};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Initialize RAG system
            tauri::async_runtime::spawn(async move {
                let _ = initialize_rag_system_with_app(app.handle()).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            rag_add_data_source,
            rag_query_documents,
            // ... other handlers
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### After (Plugin)

```rust
// src-tauri/src/main.rs
use jan_plugin_rag;

fn main() {
    tauri::Builder::default()
        .plugin(jan_plugin_rag::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## Examples

See the `examples/` directory for complete usage examples:

- `basic_usage.rs`: Simple plugin initialization
- `full_usage.rs`: Advanced configuration with MCP integration

## License

MIT License. See [LICENSE](../LICENSE) for details.

## Contributing

Contributions are welcome! Please read the contributing guidelines in the main repository.
