use rocksdb::{IteratorMode, DB};
use std::collections::HashMap;
use tauri::Manager;

#[tauri::command]
pub fn get_legacy_browser_data(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let mut path = app.path().data_dir().unwrap();

    let app_name =
        std::env::var("APP_NAME").unwrap_or_else(|_| app.config().product_name.clone().unwrap());
    path.push(app_name);
    path.push("Local Storage");
    path.push("leveldb");
    // Check if the path exists
    if !path.exists() {
        log::info!("Path {:?} does not exist, skipping migration.", path);
        return Ok(HashMap::new());
    }

    let db = DB::open_default(path);
    match db {
        Ok(db) => {
            let iter = db.iterator(IteratorMode::Start);

            let migration_kvs: HashMap<String, String> = HashMap::from([
                // Api Server
                (
                    "_file://\0\u{1}apiServerHost".to_string(),
                    "serverHost".to_string(),
                ),
                (
                    "_file://\0\u{1}apiServerPort".to_string(),
                    "serverPort".to_string(),
                ),
                (
                    "_file://\0\u{1}apiServerCorsEnabled".to_string(),
                    "corsEnabled".to_string(),
                ),
                (
                    "_file://\0\u{1}apiServerPrefix".to_string(),
                    "apiPrefix".to_string(),
                ),
                (
                    "_file://\0\u{1}apiServerVerboseLogEnabled".to_string(),
                    "verboseLogs".to_string(),
                ),
                // Proxy
                (
                    "_file://\0\u{1}proxyFeatureEnabled".to_string(),
                    "proxyEnabled".to_string(),
                ),
                (
                    "_file://\0\u{1}httpsProxyFeature".to_string(),
                    "proxyUrl".to_string(),
                ),
                (
                    "_file://\0\u{1}proxyPassword".to_string(),
                    "proxyPassword".to_string(),
                ),
                (
                    "_file://\0\u{1}proxyUsername".to_string(),
                    "proxyUsername".to_string(),
                ),
                (
                    "_file://\0\u{1}ignoreSSLFeature".to_string(),
                    "proxyIgnoreSSL".to_string(),
                ),
                (
                    "_file://\0\u{1}verifyProxySSL".to_string(),
                    "verifyProxySSL".to_string(),
                ),
                (
                    "_file://\0\u{1}verifyProxyHostSSL".to_string(),
                    "verifyProxyHostSSL".to_string(),
                ),
                (
                    "_file://\0\u{1}verifyPeerSSL".to_string(),
                    "verifyPeerSSL".to_string(),
                ),
                (
                    "_file://\0\u{1}verifyHostSSL".to_string(),
                    "verifyHostSSL".to_string(),
                ),
                ("_file://\0\u{1}noProxy".to_string(), "noProxy".to_string()),
                // Analytics
                (
                    "_file://\0\u{1}productAnalytic".to_string(),
                    "productAnalytic".to_string(),
                ),
                (
                    "_file://\0\u{1}productAnalyticPrompt".to_string(),
                    "productAnalyticPrompt".to_string(),
                ),
            ]);

            let mut results = HashMap::new();

            for item in iter {
                match item {
                    Ok((key, value)) => {
                        let key_str = String::from_utf8_lossy(&key).to_string();
                        let value_str = String::from_utf8_lossy(&value).to_string();
                        // log::info!("Key: {:?} | Value: {:?}", key_str, value_str);
                        if let Some(new_key) = migration_kvs.get(&key_str) {
                            log::info!("Migrating key {:?} to new key {:?}", key_str, new_key);

                            results.insert(new_key.to_string(), value_str.replace("\u{1}", ""));
                        }
                    }
                    Err(e) => {
                        eprintln!("Error reading from DB: {:?}", e);
                    }
                }
            }
            log::info!("Migration results: {:?}", results);
            Ok(results)
        }
        Err(e) => {
            return Ok(HashMap::new());
        }
    }
}
