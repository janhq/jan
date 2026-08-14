//! Provider authentication for the CLI: a typed capability catalog, credential
//! contracts, and (in submodules) API-key validation, registered OAuth flows,
//! and secure persistence. This module is the security boundary between what a
//! user can sign in with and what the agent runtime trusts.
//!
//! Capability metadata is non-secret by construction: keys, tokens, and
//! verifier/state values never live here. They move through
//! [`crate::core::server::provider_secrets`] only.

pub mod credentials;
pub mod providers;

use std::path::PathBuf;

pub use credentials::{Credential, CredentialStore, OAuthToken};

/// Wire transport a provider speaks, chosen at credential resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    OpenAi,
    Anthropic,
}

/// How a user can authenticate with a provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthMethod {
    ApiKey,
    AccountOAuth,
}

/// Non-secret guidance for minting an API key.
#[derive(Debug, Clone)]
pub struct ApiKeyMetadata {
    /// Human-facing page where the user creates/views keys.
    pub keys_url: &'static str,
    /// Short hint shown above the masked input.
    pub hint: &'static str,
}

/// Grant type an issued Jan OAuth registration permits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OAuthGrant {
    AuthorizationCodePkce,
    DeviceCode,
}

/// A Jan-owned, provider-issued OAuth registration. `provider_catalog()` keeps
/// this `None` for every provider until Jan actually holds an issued
/// registration with an approved redirect URI and permitted scopes; that is
/// the single gate deciding whether "Sign in with account" is offered.
#[derive(Debug, Clone)]
pub struct OAuthRegistration {
    pub client_id: &'static str,
    pub authorization_url: &'static str,
    pub token_url: &'static str,
    pub scopes: &'static [&'static str],
    pub grant: OAuthGrant,
}

/// Non-secret, typed description of one sign-in-able provider.
#[derive(Debug, Clone)]
pub struct ProviderDefinition {
    /// Provider id used in `~/.jan/config.toml` and in `<id>/<model>` ids.
    pub id: &'static str,
    /// Display name shown in pickers.
    pub name: &'static str,
    /// Default API endpoint (an OpenAI-compatible root or the Anthropic `/v1`).
    pub default_base_url: String,
    pub transport: Transport,
    pub api_key: ApiKeyMetadata,
    /// `None` means account login is NOT offered. This is a security boundary,
    /// not a disabled control: a missing registration hides the method.
    pub oauth: Option<OAuthRegistration>,
}

impl ProviderDefinition {
    /// The authentication methods this provider may offer, in display order.
    /// Account login appears only when an issued Jan registration exists.
    pub fn available_methods(&self) -> Vec<AuthMethod> {
        let mut methods = vec![AuthMethod::ApiKey];
        if self.oauth.is_some() {
            methods.push(AuthMethod::AccountOAuth);
        }
        methods
    }
}

/// The providers the TUI `/login` flow offers, in picker order.
pub fn provider_catalog() -> Vec<ProviderDefinition> {
    let catalog = vec![
        ProviderDefinition {
            id: "openai",
            name: "Codex",
            default_base_url: "https://api.openai.com/v1".to_string(),
            transport: Transport::OpenAi,
            api_key: ApiKeyMetadata {
                keys_url: "https://platform.openai.com/account/api-keys",
                hint: "get a key at platform.openai.com/account/api-keys",
            },
            oauth: None,
        },
        ProviderDefinition {
            id: "anthropic",
            name: "Claude",
            default_base_url: "https://api.anthropic.com/v1".to_string(),
            transport: Transport::Anthropic,
            api_key: ApiKeyMetadata {
                keys_url: "https://console.anthropic.com/settings/keys",
                hint: "get a key at console.anthropic.com/settings/keys",
            },
            oauth: None,
        },
        ProviderDefinition {
            id: "opencode",
            name: "OpenCode",
            default_base_url: "https://opencode.ai/zen/v1".to_string(),
            transport: Transport::OpenAi,
            api_key: ApiKeyMetadata {
                keys_url: "https://opencode.ai/docs",
                hint: "see opencode.ai/docs for how to get a key",
            },
            oauth: None,
        },
        ProviderDefinition {
            id: "deepseek",
            name: "DeepSeek",
            default_base_url: "https://api.deepseek.com/v1".to_string(),
            transport: Transport::OpenAi,
            api_key: ApiKeyMetadata {
                keys_url: "https://platform.deepseek.com/api_keys",
                hint: "get a key at platform.deepseek.com/api_keys",
            },
            oauth: None,
        },
        ProviderDefinition {
            id: "tokamak",
            name: "Tokamak",
            default_base_url: "https://api.tokamak.sh/v1".to_string(),
            transport: Transport::OpenAi,
            api_key: ApiKeyMetadata {
                keys_url: "https://tokamak.sh/settings/api-keys",
                hint: "get a key at tokamak.sh/settings/api-keys",
            },
            oauth: None,
        },
    ];
    catalog
}


/// The catalog entry for `id`, if any.
pub fn provider_by_id(id: &str) -> Option<ProviderDefinition> {
    provider_catalog().into_iter().find(|p| p.id == id)
}


/// Non-secret outcome of a successful login, safe to render and report.
#[derive(Debug, Clone, PartialEq)]
pub struct LoginResult {
    pub provider: String,
    pub models: Vec<String>,
    /// Where the non-secret provider configuration was written.
    pub config_path: PathBuf,
    /// The model adopted as `default_model`, or `None` when the user already
    /// had one (or the account has no models).
    pub default_model: Option<String>,
}

/// Why a login attempt failed. Every variant carries only safe, non-secret
/// text; errors never include the credential.
#[derive(Debug, Clone, PartialEq)]
pub enum LoginError {
    /// The entered key is empty or malformed; retryable without I/O.
    InvalidKey(String),
    /// The provider rejected the credential (HTTP 401/403).
    Unauthorized,
    /// The provider is rate limiting this credential (HTTP 429).
    RateLimited,
    /// Network, protocol, or provider 5xx failure, with a safe message.
    Unavailable(String),
    /// A validated credential could not be persisted; nothing was changed.
    Persist(String),
    /// The OAuth interaction failed; no credential was persisted.
    OAuth(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_hides_account_login_without_an_issued_registration() {
        let catalog = provider_catalog();
        let claude = catalog.iter().find(|p| p.id == "anthropic").unwrap();
        assert_eq!(claude.available_methods(), vec![AuthMethod::ApiKey]);
        // No production entry carries a registration until Jan holds one.
        for provider in &catalog {
            assert!(provider.oauth.is_none(), "{} must not offer OAuth", provider.id);
            assert_eq!(
                provider.available_methods(),
                vec![AuthMethod::ApiKey],
                "{} must offer API key only",
                provider.id
            );
        }
    }

    #[test]
    fn catalog_lists_the_five_providers_in_picker_order() {
        let ids: Vec<&str> = provider_catalog().iter().map(|p| p.id).collect();
        assert_eq!(
            ids,
            vec!["openai", "anthropic", "opencode", "deepseek", "tokamak"]
        );
        assert_eq!(provider_by_id("deepseek").unwrap().name, "DeepSeek");
        assert!(provider_by_id("nope").is_none());
    }

    #[test]
    fn available_methods_includes_account_login_when_registered() {
        let mut provider = provider_catalog()[0].clone();
        provider.oauth = Some(OAuthRegistration {
            client_id: "jan-test",
            authorization_url: "https://auth.example.com/authorize",
            token_url: "https://auth.example.com/token",
            scopes: &["model.read"],
            grant: OAuthGrant::AuthorizationCodePkce,
        });
        assert_eq!(provider.available_methods(), vec![AuthMethod::ApiKey, AuthMethod::AccountOAuth]);
    }
}
