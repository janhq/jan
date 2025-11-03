fn main() {
    tauri_plugin::Builder::new(&[
        "create_collection",
        "create_file",
        "insert_chunks",
        "search_collection",
        "delete_chunks",
        "delete_file",
        "delete_collection",
        "chunk_text",
        "get_status",
        "list_attachments",
        "get_chunks",
    ])
    .build();
}
