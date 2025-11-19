use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{mpsc::channel, Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    pub event_type: String,
    pub path: String,
    pub watcher_id: String,
}

pub struct FsWatcher {
    _watcher: RecommendedWatcher,
}

impl FsWatcher {
    pub fn new<R: Runtime>(
        app: AppHandle<R>,
        path: &str,
        event_name: String,
        watcher_id: String,
    ) -> Result<Self, String> {
        let (tx, rx) = channel();
        let watch_path = PathBuf::from(path);
        
        // Create watcher
        let mut watcher = RecommendedWatcher::new(
            move |res: notify::Result<Event>| {
                if let Ok(event) = res {
                    tx.send(event).ok();
                }
            },
            Config::default(),
        )
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

        // Watch the directory (recursive to detect subdirectory changes)
        watcher
            .watch(&watch_path, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch path: {}", e))?;

        // Spawn thread to handle events
        let app_handle = app.clone();
        let watcher_id_clone = watcher_id.clone();
        let event_name_clone = event_name.clone();
        let watch_path_clone = watch_path.clone();
        
        thread::spawn(move || {
            log::info!("RUST WATCHER: Event handler thread started for watcher {}", watcher_id_clone);
            let mut last_event_time = std::time::Instant::now();
            
            for event in rx {
                // Debounce: ignore events within 200ms of each other
                let now = std::time::Instant::now();
                if now.duration_since(last_event_time).as_millis() < 200 {
                    continue;
                }
                last_event_time = now;

                let event_type = match event.kind {
                    EventKind::Create(_) => "created",
                    EventKind::Remove(_) => "deleted",
                    // Treat Modify(Name) as deletion (folder renamed/moved away)
                    EventKind::Modify(notify::event::ModifyKind::Name(_)) => "deleted",
                    _ => continue,
                };

                // Only emit events for direct children (versions) or grandchildren (backend types)
                for path in event.paths {
                    let is_direct_child = path.parent().map_or(false, |p| p == watch_path_clone);
                    let is_grandchild = path.parent().and_then(|p| p.parent()).map_or(false, |p| p == watch_path_clone);

                    if is_direct_child || is_grandchild {
                        let change_event = FileChangeEvent {
                            event_type: event_type.to_string(),
                            path: path.to_string_lossy().to_string(),
                            watcher_id: watcher_id_clone.clone(),
                        };

                        log::info!("RUST WATCHER: Emitting {} event for: {}", event_type, path.display());
                        if let Err(e) = app_handle.emit(&event_name_clone, change_event) {
                            log::error!("RUST WATCHER: Failed to emit event: {}", e);
                        }
                    }
                }
            }
            log::warn!("RUST WATCHER: Event handler thread ended for watcher {}", watcher_id_clone);
        });

        Ok(Self { _watcher: watcher })
    }
}

#[derive(Default)]
pub struct WatcherState {
    pub watchers: Arc<Mutex<HashMap<String, FsWatcher>>>,
}

impl WatcherState {
    pub fn add_watcher(&self, id: String, watcher: FsWatcher) -> Result<(), String> {
        self.watchers
            .lock()
            .map_err(|e| format!("Failed to lock watchers: {}", e))?
            .insert(id, watcher);
        Ok(())
    }

    pub fn remove_watcher(&self, id: &str) -> Result<(), String> {
        self.watchers
            .lock()
            .map_err(|e| format!("Failed to lock watchers: {}", e))?
            .remove(id);
        Ok(())
    }
}

#[tauri::command]
pub fn watch_directory<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    event_name: String,
) -> Result<String, String> {
    let watcher_id = uuid::Uuid::new_v4().to_string();
    let watcher = FsWatcher::new(app.clone(), &path, event_name, watcher_id.clone())?;
    
    // Get or create state
    let state = app.try_state::<WatcherState>()
        .ok_or_else(|| "WatcherState not initialized".to_string())?;
    
    state.add_watcher(watcher_id.clone(), watcher)?;
    Ok(watcher_id)
}

#[tauri::command]
pub fn stop_watch<R: Runtime>(
    app: AppHandle<R>,
    watcher_id: String,
) -> Result<(), String> {
    let state = app.try_state::<WatcherState>()
        .ok_or_else(|| "WatcherState not initialized".to_string())?;
    
    state.remove_watcher(&watcher_id)
}
