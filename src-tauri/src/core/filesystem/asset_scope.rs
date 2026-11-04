//! Runtime grants for the asset protocol.
//!
//! `tauri.conf.json` allows nothing statically: a `**/*` scope let any script
//! in the window read every file on disk, the data folder's settings and keys
//! included. The window only streams three kinds of file through
//! `convertFileSrc`, and each is granted here when it comes into play:
//!
//! - the Cowork session sandboxes, at startup ([`allow_cowork_sandboxes`]);
//! - a file the user picked in the open dialog ([`allow_picked_file`]);
//! - a Cowork session's attached folder ([`asset_scope_allow_folder`]), which
//!   is user-chosen and can live anywhere, so it cannot be listed up front.

use std::path::Path;

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_agent_tools::workspace;

use crate::core::app::commands::get_jan_data_folder_path;

/// Grant `<jan_data_folder>/agent-workspace/sessions`, where every Cowork
/// session writes the artifacts its cards and preview pane show.
pub fn allow_cowork_sandboxes<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let sessions = workspace::sessions_dir(&get_jan_data_folder_path(app.clone()));
    app.asset_protocol_scope().allow_directory(sessions, true)
}

/// Grant one file the user just picked, so the renderer can `fetch` it
/// through the asset protocol (the chat image, audio and video pickers).
pub fn allow_picked_file<R: Runtime>(app: &AppHandle<R>, path: &Path) {
    if let Err(e) = app.asset_protocol_scope().allow_file(path) {
        log::warn!("asset scope: could not allow {}: {e}", path.display());
    }
}

/// Grant a Cowork session's attached folder. Validated the way the agent's
/// read root is, so it can never be the filesystem root or contain the Jan
/// data folder (and with it `settings.json` and the provider keys).
#[tauri::command]
pub fn asset_scope_allow_folder<R: Runtime>(
    app: AppHandle<R>,
    folder: String,
) -> Result<(), String> {
    let data_folder = get_jan_data_folder_path(app.clone());
    let sessions = workspace::sessions_dir(&data_folder);
    let canonical =
        workspace::validate_read_root(Path::new(&folder), &sessions, Some(&data_folder))?;
    app.asset_protocol_scope()
        .allow_directory(canonical, true)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::mock_app;

    #[test]
    fn nothing_is_served_until_granted() {
        let app = mock_app();
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.png");
        std::fs::write(&file, b"x").unwrap();
        assert!(!app.asset_protocol_scope().is_allowed(&file));
    }

    #[test]
    fn an_attached_folder_is_served_recursively() {
        let app = mock_app();
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("out").join("chart.png");
        std::fs::create_dir_all(nested.parent().unwrap()).unwrap();
        std::fs::write(&nested, b"x").unwrap();
        let folder = dir.path().to_string_lossy().into_owned();
        asset_scope_allow_folder(app.handle().clone(), folder).unwrap();
        assert!(app.asset_protocol_scope().is_allowed(&nested));
    }

    #[test]
    fn a_folder_containing_the_data_folder_is_refused() {
        let app = mock_app();
        let data = get_jan_data_folder_path(app.handle().clone());
        let parent = data.parent().unwrap().to_string_lossy().into_owned();
        assert!(asset_scope_allow_folder(app.handle().clone(), parent).is_err());
        assert!(!app.asset_protocol_scope().is_allowed(&data));
    }

    #[test]
    fn the_sandboxes_are_served_but_not_the_rest_of_the_data_folder() {
        let app = mock_app();
        let data = get_jan_data_folder_path(app.handle().clone());
        let artifact = workspace::sessions_dir(&data).join("s1").join("a.png");
        std::fs::create_dir_all(artifact.parent().unwrap()).unwrap();
        std::fs::write(&artifact, b"x").unwrap();
        let settings = data.join("settings.json");
        std::fs::write(&settings, b"{}").unwrap();
        allow_cowork_sandboxes(app.handle()).unwrap();
        assert!(app.asset_protocol_scope().is_allowed(&artifact));
        assert!(!app.asset_protocol_scope().is_allowed(&settings));
    }

    #[test]
    fn a_picked_file_is_served_but_not_its_siblings() {
        let app = mock_app();
        let dir = tempfile::tempdir().unwrap();
        let picked = dir.path().join("photo.png");
        let sibling = dir.path().join("secret.txt");
        std::fs::write(&picked, b"x").unwrap();
        std::fs::write(&sibling, b"x").unwrap();
        allow_picked_file(app.handle(), &picked);
        assert!(app.asset_protocol_scope().is_allowed(&picked));
        assert!(!app.asset_protocol_scope().is_allowed(&sibling));
    }
}
