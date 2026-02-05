//! Template Engine
//!
//! Simple template rendering for webhook payload transformation.
//! Supports variable substitution with {{variable}} syntax.

use serde_json::Value;
use std::collections::HashMap;

/// Template context for rendering
#[derive(Debug, Clone, Default)]
pub struct TemplateContext {
    /// Request metadata (from the webhook request)
    pub request: HashMap<String, Value>,
    /// Path parameters from the hook mapping
    pub path_params: HashMap<String, String>,
    /// Platform-specific data
    pub platform: HashMap<String, Value>,
    /// Timestamp when request was received
    pub timestamp: i64,
}

impl TemplateContext {
    /// Create a new context with current timestamp
    pub fn new() -> Self {
        Self {
            request: HashMap::new(),
            path_params: HashMap::new(),
            platform: HashMap::new(),
            timestamp: chrono::Utc::now().timestamp_millis(),
        }
    }

    /// Add request data
    pub fn with_request(mut self, request: HashMap<String, Value>) -> Self {
        self.request = request;
        self
    }

    /// Add path parameters
    pub fn with_path_params(mut self, params: HashMap<String, String>) -> Self {
        self.path_params = params;
        self
    }

    /// Add platform data
    pub fn with_platform(mut self, platform: HashMap<String, Value>) -> Self {
        self.platform = platform;
        self
    }

    /// Get a value from the context (checks all sources)
    pub fn get(&self, key: &str) -> Option<&Value> {
        // Check path params first (as string)
        if let Some(val) = self.path_params.get(key) {
            return Some(&Value::String(val.clone()));
        }

        // Check request
        if let Some(val) = self.request.get(key) {
            return Some(val);
        }

        // Check platform
        self.platform.get(key)
    }
}

/// Template engine for rendering templates
#[derive(Debug, Clone, Default)]
pub struct TemplateEngine;

impl TemplateEngine {
    /// Render a template string with the given context
    pub fn render(template: &str, context: &TemplateContext) -> Result<String, TemplateError> {
        let mut result = String::new();
        let mut chars = template.chars().peekable();
        let mut buffer = String::new();

        while let Some(ch) = chars.next() {
            if ch == '{' {
                // Check for {{
                if chars.peek() == Some(&'{') {
                    chars.next(); // consume second {

                    // Extract variable name
                    buffer.clear();
                    while let Some(&ch) = chars.peek() {
                        if ch == '}' {
                            chars.next(); // consume }
                            if chars.peek() == Some(&'}' ) {
                                chars.next(); // consume second }
                                break;
                            }
                        } else {
                            buffer.push(ch);
                            chars.next();
                        }
                    }

                    // Render the variable
                    let value = Self::render_variable(&buffer, context)?;
                    result.push_str(&value);
                } else {
                    result.push(ch);
                }
            } else {
                result.push(ch);
            }
        }

        Ok(result)
    }

    /// Render a single variable
    fn render_variable(name: &str, context: &TemplateContext) -> Result<String, TemplateError> {
        // Handle special variables
        match name {
            "timestamp" => return Ok(context.timestamp.to_string()),
            "timestamp_ms" => return Ok(context.timestamp.to_string()),
            "timestamp_iso" => {
                let dt = chrono::DateTime::from_timestamp_millis(context.timestamp)
                    .ok_or_else(|| TemplateError::InvalidTimestamp(context.timestamp))?;
                return Ok(dt.to_rfc3339());
            }
            _ => {}
        }

        // Check context for the variable
        if let Some(value) = context.get(name) {
            Self::value_to_string(value)
        } else {
            Err(TemplateError::VariableNotFound(name.to_string()))
        }
    }

    /// Convert a JSON value to string
    fn value_to_string(value: &Value) -> Result<String, TemplateError> {
        match value {
            Value::String(s) => Ok(s.clone()),
            Value::Number(n) => Ok(n.to_string()),
            Value::Bool(b) => Ok(b.to_string()),
            Value::Null => Ok(String::new()),
            Value::Array(arr) => {
                let items: Result<Vec<String>, _> = arr.iter()
                    .map(|v| Self::value_to_string(v))
                    .collect();
                items.map(|v| v.join(", "))
            }
            Value::Object(obj) => {
                // For objects, return as JSON string
                serde_json::to_string(obj).map_err(|_| TemplateError::InvalidFormat)
            }
        }
    }

    /// Transform a payload using an input template
    pub fn transform_payload(
        payload: &Value,
        template: &str,
        context: &TemplateContext,
    ) -> Result<Value, TemplateError> {
        let rendered = Self::render(template, context)?;

        // Try to parse as JSON
        match serde_json::from_str(&rendered) {
            Ok(json) => Ok(json),
            Err(_) => {
                // If not valid JSON, return as string in a "text" field
                Ok(serde_json::json!({
                    "text": rendered,
                    "_original": payload
                }))
            }
        }
    }
}

/// Template errors
#[derive(Debug, thiserror::Error)]
pub enum TemplateError {
    #[error("Variable not found: {0}")]
    VariableNotFound(String),

    #[error("Invalid template format")]
    InvalidFormat,

    #[error("Invalid timestamp: {0}")]
    InvalidTimestamp(i64),

    #[error("Template rendering failed: {0}")]
    RenderingFailed(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_variable() {
        let mut request = HashMap::new();
        request.insert("user".to_string(), Value::String("john".to_string()));
        request.insert("message".to_string(), Value::String("hello".to_string()));

        let context = TemplateContext::new()
            .with_request(request);

        let template = "Hello {{user}}, you said: {{message}}";
        let result = TemplateEngine::render(template, &context).unwrap();

        assert_eq!(result, "Hello john, you said: hello");
    }

    #[test]
    fn test_path_params() {
        let mut path_params = HashMap::new();
        path_params.insert("platform".to_string(), "discord".to_string());
        path_params.insert("event_id".to_string(), "12345".to_string());

        let context = TemplateContext::new()
            .with_path_params(path_params);

        let template = "Platform: {{platform}}, Event: {{event_id}}";
        let result = TemplateEngine::render(template, &context).unwrap();

        assert_eq!(result, "Platform: discord, Event: 12345");
    }

    #[test]
    fn test_special_variables() {
        let context = TemplateContext::new();

        let template = "Time: {{timestamp}}, ISO: {{timestamp_iso}}";
        let result = TemplateEngine::render(template, &context).unwrap();

        assert!(result.contains("Time: "));
        assert!(result.contains("ISO: 20")); // RFC3339 starts with year
    }

    #[test]
    fn test_missing_variable() {
        let context = TemplateContext::new();

        let template = "Value: {{unknown}}";
        let result = TemplateEngine::render(template, &context);

        assert!(matches!(result, Err(TemplateError::VariableNotFound(_))));
    }

    #[test]
    fn test_nested_variable() {
        let mut request = HashMap::new();
        request.insert("data".to_string(), serde_json::json!({
            "nested": "value"
        }));

        let context = TemplateContext::new()
            .with_request(request);

        let template = "Value: {{data}}";
        let result = TemplateEngine::render(template, &context).unwrap();

        assert!(result.contains("nested")); // JSON string representation
    }

    #[test]
    fn test_escaping() {
        let mut request = HashMap::new();
        request.insert("text".to_string(), Value::String("Hello {{world}}".to_string()));

        let context = TemplateContext::new()
            .with_request(request);

        // Double braces should be treated as literal when not a complete variable
        let template = "Text: {{{text}}}"; // Triple brace to escape
        let result = TemplateEngine::render(template, &context).unwrap();

        assert!(result.contains("{{world}}"));
    }

    #[test]
    fn test_payload_transformation() {
        let payload = serde_json::json!({
            "event": "message",
            "content": "Hello world",
            "user": "john"
        });

        let mut path_params = HashMap::new();
        path_params.insert("platform".to_string(), "discord".to_string());

        let context = TemplateContext::new()
            .with_request([
                ("event".to_string(), payload.clone()),
            ].iter().cloned().collect())
            .with_path_params(path_params);

        let template = r#"{{content}} - from {{user}}"#;
        let result = TemplateEngine::transform_payload(&payload, template, &context).unwrap();

        assert_eq!(result, "Hello world - from john");
    }

    #[test]
    fn test_conditional_text() {
        let context = TemplateContext::new();

        // Test that braces without complete variable are passed through
        let template = "Check {invalid syntax} here";
        let result = TemplateEngine::render(template, &context).unwrap();

        assert_eq!(result, "Check {invalid syntax} here");
    }
}