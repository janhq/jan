use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppConfiguration {
    pub data_folder: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub modelscope_token: Option<String>,
}

impl AppConfiguration {
    pub fn default() -> Self {
        Self {
            data_folder: String::from("./data"),
            modelscope_token: None,
        }
    }
}
