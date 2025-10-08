fn main() {
    tauri_plugin::Builder::new(&[
        "create_collection",
        "insert_chunks",
        "search_collection",
        "delete_chunks",
        "delete_collection",
        "chunk_text",
        "get_status",
    ])
    .build();
}
