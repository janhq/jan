use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppConfiguration {
    pub data_folder: String,
    // Add other fields as needed
}

impl AppConfiguration {
    pub fn default() -> Self {
        Self {
            data_folder: String::from("./data"), // Set a default value for the data_folder
                                                 // Add other fields with default values as needed
        }
    }
}
