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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_uses_relative_data_folder() {
        let config = AppConfiguration::default();
        assert_eq!(config.data_folder, "./data");
    }

    #[test]
    fn serializes_round_trip_via_json() {
        let config = AppConfiguration {
            data_folder: "/tmp/jan".to_string(),
        };
        let json = serde_json::to_string(&config).expect("serialize");
        assert!(json.contains("\"data_folder\""));
        assert!(json.contains("/tmp/jan"));

        let parsed: AppConfiguration = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed.data_folder, config.data_folder);
    }

    #[test]
    fn deserializes_from_known_payload() {
        let json = r#"{"data_folder":"/var/lib/jan"}"#;
        let parsed: AppConfiguration = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.data_folder, "/var/lib/jan");
    }

    #[test]
    fn clone_preserves_data_folder() {
        let config = AppConfiguration {
            data_folder: "x".into(),
        };
        let dup = config.clone();
        assert_eq!(config.data_folder, dup.data_folder);
    }
}
