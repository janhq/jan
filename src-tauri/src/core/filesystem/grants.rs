//! Read grants for the read-only file commands (`exists_sync`, `file_stat`,
//! `read_file_sync`, `readdir_sync`).
//!
//! These commands take paths from the web view. Inside the Jan data folder
//! they always work. Outside it a path is readable only when the user handed
//! it to Jan:
//! - **picked in a native dialog** (`open_dialog` records every pick here, in
//!   Rust, where the web view cannot forge it): a picked file grants that file,
//!   a picked folder grants everything under it;
//! - **typed as an `@path` reference**: any ordinary file under the home
//!   folder, but never through a dot-prefixed folder (`.ssh`, `.aws`,
//!   `.config`, ...) or per-app private data (`Library`, `AppData`; see
//!   [`PRIVATE_APP_DATA`]).
//!
//! Paths are compared canonicalized (symlinks resolved) and component by
//! component, never as glob patterns. Grants persist in a file next to
//! `settings.json`, outside the data folder, so the web view cannot write it.
//! The first run seeds grants from the `model.yml` files of models already
//! imported in place; those files are writable by the web view, so only
//! `.gguf` files and MLX model folders (a `config.json` next to the weights)
//! are taken from them.

use super::helpers::canonical_scope_path;
use crate::core::app::commands::{get_configuration_file_path, get_jan_data_folder_path};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Manager, Runtime};

/// Prefix of the error a denied read returns, so callers can tell it from an
/// I/O error.
pub const DENIED_PREFIX: &str = "fs_read_denied";

pub const STORE_FILE_NAME: &str = "fs-grants.json";

/// What `home_read_allowed` refuses below the home folder, as lowercase
/// components relative to home, besides everything dot-prefixed. These hold
/// per-app private data (session tokens, cookies, keychains, browser and chat
/// profiles), so they are refused as a whole instead of by listing the apps
/// that keep secrets there. `Library` keeps the folders that are the user's
/// own files; Windows has no such folder inside `AppData`.
const PRIVATE_APP_DATA: &[(&[&str], &[&[&str]])] = &[
    (
        &["library"],
        &[
            &["library", "cloudstorage"],
            &["library", "mobile documents"],
        ],
    ),
    (&["appdata"], &[]),
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "path", rename_all = "lowercase")]
enum Grant {
    File(PathBuf),
    Dir(PathBuf),
}

#[derive(Serialize, Deserialize)]
struct StoreFile {
    version: u32,
    grants: Vec<Grant>,
}

const STORE_VERSION: u32 = 1;

impl Grant {
    fn for_path(canonical: PathBuf) -> Self {
        if canonical.is_dir() {
            Grant::Dir(canonical)
        } else {
            Grant::File(canonical)
        }
    }

    fn path(&self) -> &Path {
        match self {
            Grant::File(path) | Grant::Dir(path) => path,
        }
    }

    fn covers(&self, canonical: &Path) -> bool {
        match self {
            Grant::File(path) => canonical == path,
            Grant::Dir(path) => canonical.starts_with(path),
        }
    }
}

/// Adds `grant` unless an existing grant already covers it; a folder grant
/// replaces the narrower grants beneath it. Returns whether the set changed.
fn add(grants: &mut Vec<Grant>, grant: Grant) -> bool {
    if grants.iter().any(|g| g.covers(grant.path())) {
        return false;
    }
    if let Grant::Dir(dir) = &grant {
        grants.retain(|g| !g.path().starts_with(dir));
    }
    grants.push(grant);
    true
}

#[derive(Default)]
struct Inner {
    grants: Vec<Grant>,
    /// Where grants persist. `None` keeps them in memory only.
    store: Option<PathBuf>,
}

#[derive(Default)]
pub struct ReadGrants {
    inner: Mutex<Inner>,
    /// The canonical home folder that typed `@path` references may read under
    /// (see [`home_read_allowed`]). `None` turns that rule off, which is what
    /// [`ReadGrants::default`] gives tests.
    home: Option<PathBuf>,
}

impl ReadGrants {
    pub fn with_home(home: Option<PathBuf>) -> Self {
        Self {
            inner: Mutex::default(),
            home: home.map(|home| canonical_scope_path(&home)),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Whether `canonical` (already run through `canonical_scope_path`) is
    /// covered by a grant.
    pub fn allows(&self, canonical: &Path) -> bool {
        self.lock().grants.iter().any(|g| g.covers(canonical))
    }

    /// Whether a typed `@path` reference may read `canonical`.
    pub fn allows_typed_reference(&self, canonical: &Path) -> bool {
        self.home
            .as_deref()
            .is_some_and(|home| home_read_allowed(canonical, home))
    }

    /// Records a path the user picked in a native dialog.
    pub fn record_pick(&self, path: &Path) {
        let mut inner = self.lock();
        if add(
            &mut inner.grants,
            Grant::for_path(canonical_scope_path(path)),
        ) {
            persist(&inner);
        }
    }

    /// Loads the persisted grants, or on the first run seeds them from
    /// `seed()` and creates the store. A store inside the data folder is not
    /// trusted: the web view can write there.
    pub fn attach_store(
        &self,
        store: PathBuf,
        data_folder: &Path,
        seed: impl FnOnce() -> Vec<PathBuf>,
    ) {
        if canonical_scope_path(&store).starts_with(canonical_scope_path(data_folder)) {
            log::warn!(
                "read grants: {} is inside the data folder, keeping grants in memory only",
                store.display()
            );
            return;
        }
        let mut inner = self.lock();
        let mut first_run = false;
        match fs::read_to_string(&store) {
            Ok(text) => match serde_json::from_str::<StoreFile>(&text) {
                Ok(file) => inner.grants = file.grants,
                Err(e) => log::warn!("read grants: ignoring unreadable {}: {e}", store.display()),
            },
            Err(e) if e.kind() == ErrorKind::NotFound => first_run = true,
            Err(e) => log::warn!("read grants: cannot read {}: {e}", store.display()),
        }
        inner.store = Some(store);
        if first_run {
            for path in seed() {
                add(
                    &mut inner.grants,
                    Grant::for_path(canonical_scope_path(&path)),
                );
            }
            persist(&inner);
        }
    }
}

fn persist(inner: &Inner) {
    let Some(store) = &inner.store else { return };
    let file = StoreFile {
        version: STORE_VERSION,
        grants: inner.grants.clone(),
    };
    let written = (|| -> std::io::Result<()> {
        if let Some(parent) = store.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = store.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(&file)?)?;
        fs::rename(&tmp, store)
    })();
    if let Err(e) = written {
        log::warn!("read grants: cannot write {}: {e}", store.display());
    }
}

/// Records the paths a native dialog just returned.
pub fn record_picks<R: Runtime>(app: &AppHandle<R>, picks: &[PathBuf]) {
    if let Some(grants) = app.try_state::<ReadGrants>() {
        for pick in picks {
            grants.record_pick(pick);
        }
    }
}

/// Loads the persisted grants at startup (see [`ReadGrants::attach_store`]).
pub fn init<R: Runtime>(app: &AppHandle<R>) {
    let Some(grants) = app.try_state::<ReadGrants>() else {
        return;
    };
    let store = get_configuration_file_path(app.clone()).with_file_name(STORE_FILE_NAME);
    let data_folder = get_jan_data_folder_path(app.clone());
    grants.attach_store(store, &data_folder, || in_place_model_paths(&data_folder));
}

/// Whether a typed `@path` reference may read `canonical`: the home folder
/// itself (the `@` picker starts there and lists it) or anything under
/// `canonical_home`, never through a dot-prefixed folder or file and never
/// inside a [`PRIVATE_APP_DATA`] folder. Components compare case-insensitively,
/// as the macOS and Windows default file systems do.
pub fn home_read_allowed(canonical: &Path, canonical_home: &Path) -> bool {
    let Ok(relative) = canonical.strip_prefix(canonical_home) else {
        return false;
    };
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().to_lowercase()),
            _ => return false,
        }
    }
    if parts.iter().any(|part| part.starts_with('.')) {
        return false;
    }
    !PRIVATE_APP_DATA.iter().any(|(dir, exceptions)| {
        starts_with_components(&parts, dir)
            && !exceptions
                .iter()
                .any(|keep| starts_with_components(&parts, keep))
    })
}

fn starts_with_components(parts: &[String], prefix: &[&str]) -> bool {
    parts.len() >= prefix.len() && parts.iter().zip(prefix).all(|(a, b)| a == b)
}

/// Absolute paths that models imported in place point at, read from the
/// `model.yml` files under the data folder. Used once, to seed the grants of
/// an existing install.
///
/// The web view can write those files, so only values that look like what the
/// app itself stores are taken: see [`is_model_path`].
pub fn in_place_model_paths(data_folder: &Path) -> Vec<PathBuf> {
    let mut configs = Vec::new();
    for engine in ["llamacpp", "mlx"] {
        collect_model_configs(&data_folder.join(engine).join("models"), 4, &mut configs);
    }
    let mut paths: Vec<PathBuf> = Vec::new();
    for config in configs {
        let Ok(text) = fs::read_to_string(&config) else {
            continue;
        };
        let Ok(serde_yaml::Value::Mapping(map)) = serde_yaml::from_str::<serde_yaml::Value>(&text)
        else {
            continue;
        };
        for (key, value) in &map {
            let (Some(key), Some(value)) = (key.as_str(), value.as_str()) else {
                continue;
            };
            let path = Path::new(value);
            if path.is_absolute() && is_model_path(key, path) && !paths.iter().any(|p| p == path) {
                paths.push(path.to_path_buf());
            }
        }
    }
    paths
}

/// Whether `path`, the value of `key` in a `model.yml`, is something Jan
/// stores for a model imported in place: the weights or projector of a
/// llama.cpp model (a `.gguf` file) or an MLX model folder (it holds a
/// `config.json`). A `.gguf` need not exist yet, as an external drive may not
/// be mounted at the first start.
fn is_model_path(key: &str, path: &Path) -> bool {
    let gguf = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("gguf"))
        && !path.is_dir();
    match key {
        "mmproj_path" => gguf,
        "model_path" => gguf || holds_mlx_weights(path),
        _ => false,
    }
}

/// Whether `dir` is an MLX model folder: a `config.json` next to the weights
/// (`model.safetensors`, or its shard index). Many tools keep a `config.json`
/// of their own in a folder, so that file alone does not make a model.
fn holds_mlx_weights(dir: &Path) -> bool {
    dir.join("config.json").is_file()
        && (dir.join("model.safetensors").is_file()
            || dir.join("model.safetensors.index.json").is_file())
}

/// Collects `model.yml` files under `dir`, `depth` folder levels deep,
/// without following symlinked folders.
fn collect_model_configs(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_file() && entry.file_name() == "model.yml" {
            out.push(entry.path());
        } else if kind.is_dir() && depth > 0 {
            collect_model_configs(&entry.path(), depth - 1, out);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn canon(path: &Path) -> PathBuf {
        canonical_scope_path(path)
    }

    #[test]
    fn a_picked_folder_grants_everything_under_it_but_not_its_neighbours() {
        let tmp = TempDir::new().unwrap();
        let picked = tmp.path().join("project");
        let lookalike = tmp.path().join("project-other");
        fs::create_dir_all(picked.join("src")).unwrap();
        fs::create_dir_all(&lookalike).unwrap();
        fs::write(picked.join("src").join("a.rs"), "x").unwrap();
        fs::write(picked.join(".env"), "k=v").unwrap();
        fs::write(lookalike.join("b.txt"), "y").unwrap();

        let grants = ReadGrants::default();
        grants.record_pick(&picked);

        assert!(grants.allows(&canon(&picked)));
        assert!(grants.allows(&canon(&picked.join("src").join("a.rs"))));
        assert!(
            grants.allows(&canon(&picked.join(".env"))),
            "a picked folder includes its own dotfiles"
        );
        assert!(
            !grants.allows(&canon(&lookalike.join("b.txt"))),
            "a folder that only shares a name prefix is not covered"
        );
        assert!(
            !grants.allows(&canon(tmp.path())),
            "the parent is not covered"
        );
    }

    #[test]
    fn a_picked_file_grants_only_that_file() {
        let tmp = TempDir::new().unwrap();
        let picked = tmp.path().join("notes.txt");
        let other = tmp.path().join("other.txt");
        fs::write(&picked, "a").unwrap();
        fs::write(&other, "b").unwrap();

        let grants = ReadGrants::default();
        grants.record_pick(&picked);

        assert!(grants.allows(&canon(&picked)));
        assert!(!grants.allows(&canon(&other)));
        assert!(!grants.allows(&canon(tmp.path())));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_inside_a_granted_folder_cannot_reach_outside_it() {
        let tmp = TempDir::new().unwrap();
        let granted = tmp.path().join("granted");
        let secret_dir = tmp.path().join("secret");
        fs::create_dir_all(&granted).unwrap();
        fs::create_dir_all(&secret_dir).unwrap();
        fs::write(secret_dir.join("key"), "s").unwrap();
        std::os::unix::fs::symlink(secret_dir.join("key"), granted.join("link")).unwrap();

        let grants = ReadGrants::default();
        grants.record_pick(&granted);

        assert!(!grants.allows(&canon(&granted.join("link"))));
    }

    #[test]
    fn grants_survive_a_restart() {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().join("data");
        let store = tmp.path().join("config").join(STORE_FILE_NAME);
        let picked = tmp.path().join("models");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&picked).unwrap();

        let first = ReadGrants::default();
        first.attach_store(store.clone(), &data, Vec::new);
        first.record_pick(&picked);

        let second = ReadGrants::default();
        second.attach_store(store, &data, || {
            panic!("seeding must not run when a store exists")
        });
        assert!(second.allows(&canon(&picked)));
    }

    #[test]
    fn the_first_run_seeds_once_and_never_again() {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().join("data");
        let store = tmp.path().join("config").join(STORE_FILE_NAME);
        let model = tmp.path().join("model-dir");
        let later = tmp.path().join("later-dir");
        for dir in [&data, &model, &later] {
            fs::create_dir_all(dir).unwrap();
        }

        let first = ReadGrants::default();
        first.attach_store(store.clone(), &data, || vec![model.clone()]);
        assert!(first.allows(&canon(&model)));
        assert!(store.exists(), "the first run creates the store");

        let second = ReadGrants::default();
        second.attach_store(store, &data, || vec![later.clone()]);
        assert!(
            second.allows(&canon(&model)),
            "the seeded grant was persisted"
        );
        assert!(
            !second.allows(&canon(&later)),
            "a second run does not seed again"
        );
    }

    #[test]
    fn a_store_inside_the_data_folder_is_not_trusted() {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().join("data");
        let secret = tmp.path().join("secret");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&secret).unwrap();
        let store = data.join(STORE_FILE_NAME);
        let forged = format!(
            r#"{{"version":1,"grants":[{{"kind":"dir","path":{:?}}}]}}"#,
            canon(&secret).to_string_lossy()
        );
        fs::write(&store, forged).unwrap();

        let grants = ReadGrants::default();
        grants.attach_store(store.clone(), &data, Vec::new);
        grants.record_pick(&tmp.path().join("picked"));

        assert!(
            !grants.allows(&canon(&secret)),
            "a forged store grants nothing"
        );
        assert!(
            !fs::read_to_string(&store).unwrap().contains("picked"),
            "nothing is written into the data folder"
        );
    }

    #[test]
    fn a_corrupt_store_starts_empty() {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().join("data");
        let store = tmp.path().join("config").join(STORE_FILE_NAME);
        let dir = tmp.path().join("dir");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&dir).unwrap();
        fs::create_dir_all(store.parent().unwrap()).unwrap();
        fs::write(&store, "{ not json").unwrap();

        let grants = ReadGrants::default();
        grants.attach_store(store, &data, Vec::new);

        assert!(!grants.allows(&canon(&dir)));
    }

    #[test]
    fn typed_references_reach_ordinary_files_under_home_only() {
        let tmp = TempDir::new().unwrap();
        let home = tmp.path().join("home");
        let outside = tmp.path().join("outside").join("a.txt");
        for rel in [
            "Documents/notes.txt",
            "Library/CloudStorage/Dropbox/a.txt",
            "Library/Mobile Documents/com~apple~CloudDocs/b.txt",
            ".ssh/id_rsa",
            ".config/app/x",
            "projects/app/.env",
            "Library/Keychains/login.keychain-db",
            "Library/Application Support/Google/Chrome/Default/Cookies",
            "Library/Application Support/Slack/Cookies",
            "Library/Application Support/discord/Local Storage/leveldb/1.ldb",
            "Library/Application Support/Code/User/globalStorage/state.vscdb",
            "Library/Containers/com.example.app/Data/token",
            "AppData/Roaming/Microsoft/Credentials/blob",
            "AppData/Roaming/discord/Local Storage/leveldb/1.ldb",
            "AppData/Roaming/Code/User/globalStorage/state.vscdb",
            "AppData/Local/Slack/storage",
        ] {
            let p = home.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, "x").unwrap();
        }
        fs::create_dir_all(outside.parent().unwrap()).unwrap();
        fs::write(&outside, "x").unwrap();
        let h = canon(&home);
        let ok = |rel: &str| home_read_allowed(&canon(&home.join(rel)), &h);

        assert!(ok("Documents/notes.txt"));
        assert!(
            ok("Library/CloudStorage/Dropbox/a.txt"),
            "cloud storage holds the user's files"
        );
        assert!(ok("Library/Mobile Documents/com~apple~CloudDocs/b.txt"));
        assert!(!ok(".ssh/id_rsa"));
        assert!(!ok(".config/app/x"));
        assert!(
            !ok("projects/app/.env"),
            "a hidden folder or file anywhere below home is refused"
        );
        // Per-app private data is refused as a whole, not by naming the apps
        // that keep tokens there.
        for private in [
            "Library/Keychains/login.keychain-db",
            "library/keychains/login.keychain-db",
            "Library/Application Support/Google/Chrome/Default/Cookies",
            "Library/Application Support/Slack/Cookies",
            "Library/Application Support/discord/Local Storage/leveldb/1.ldb",
            "Library/Application Support/Code/User/globalStorage/state.vscdb",
            "Library/Containers/com.example.app/Data/token",
            "AppData/Roaming/Microsoft/Credentials/blob",
            "AppData/Roaming/discord/Local Storage/leveldb/1.ldb",
            "AppData/Roaming/Code/User/globalStorage/state.vscdb",
            "AppData/Local/Slack/storage",
        ] {
            assert!(!ok(private), "{private} is application data");
        }
        assert!(
            home_read_allowed(&h, &h),
            "the home folder can be listed: the @ picker starts there"
        );
        assert!(!home_read_allowed(&canon(&outside), &h), "outside home");
    }

    /// Writes a model.yml under `data/<engine>/models/<name>` with `body`.
    fn write_model_yml(data: &Path, engine: &str, name: &str, body: &str) {
        let dir = data.join(engine).join("models").join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("model.yml"), body).unwrap();
    }

    #[test]
    fn seeding_takes_model_weights_and_model_folders_only() {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().join("data");
        let weights = tmp.path().join("external").join("model.gguf");
        let mmproj = tmp.path().join("external").join("mmproj.GGUF");
        let mlx_dir = tmp.path().join("mlx-weights");
        fs::create_dir_all(weights.parent().unwrap()).unwrap();
        fs::create_dir_all(&mlx_dir).unwrap();
        fs::write(&weights, "w").unwrap();
        fs::write(&mmproj, "p").unwrap();
        fs::write(mlx_dir.join("config.json"), "{}").unwrap();
        fs::write(mlx_dir.join("model.safetensors"), "w").unwrap();
        write_model_yml(
            &data,
            "llamacpp",
            "m1",
            &format!(
                "model_path: {}\nmmproj_path: {}\nname: m1\n",
                weights.display(),
                mmproj.display()
            ),
        );
        write_model_yml(
            &data,
            "mlx",
            "m2",
            &format!("model_path: {}\n", mlx_dir.display()),
        );
        // Relative paths stay data-folder paths.
        write_model_yml(
            &data,
            "llamacpp",
            "m3",
            "model_path: llamacpp/models/m3/model.gguf\nmmproj_path: llamacpp/models/m3/mmproj.gguf\n",
        );

        let mut found = in_place_model_paths(&data);
        found.sort();
        let mut expected = vec![weights, mmproj, mlx_dir];
        expected.sort();
        assert_eq!(found, expected);
    }

    #[test]
    fn seeding_ignores_a_planted_model_yml_that_names_something_else() {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().join("data");
        let home = tmp.path().join("home");
        let key = home.join(".ssh").join("id_rsa");
        let project = tmp.path().join("project");
        let docker = home.join(".docker");
        fs::create_dir_all(key.parent().unwrap()).unwrap();
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&docker).unwrap();
        fs::write(&key, "PRIVATE").unwrap();
        fs::write(project.join("notes.txt"), "n").unwrap();
        fs::write(docker.join("config.json"), "{\"auths\":{}}").unwrap();

        for (i, body) in [
            "model_path: /\n".to_string(),
            format!("model_path: {}\n", home.display()),
            format!("model_path: {}\n", key.display()),
            // A folder with a `config.json` but no weights is not a model
            // folder: `~/.docker` has one, and so does most tooling.
            format!("model_path: {}\n", docker.display()),
            format!("model_path: {}\n", project.display()),
            // Only `model_path` and `mmproj_path` name model files.
            format!("other_path: {}\n", key.display()),
            format!("draft_model_path: {}\n", key.display()),
            // A weights file must be a `.gguf`.
            format!("mmproj_path: {}\n", key.display()),
        ]
        .iter()
        .enumerate()
        {
            write_model_yml(&data, "llamacpp", &format!("p{i}"), body);
        }

        assert_eq!(in_place_model_paths(&data), Vec::<PathBuf>::new());
    }
}
