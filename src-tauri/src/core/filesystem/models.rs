#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub is_directory: bool,
    pub size: u64,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct DialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogOpenOptions {
    pub multiple: Option<bool>,
    pub directory: Option<bool>,
    pub default_path: Option<String>,
    pub filters: Option<Vec<DialogFilter>>,
}
