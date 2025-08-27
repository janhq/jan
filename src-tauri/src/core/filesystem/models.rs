#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub is_directory: bool,
    pub size: u64,
}
