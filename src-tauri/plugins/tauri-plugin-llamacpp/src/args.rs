use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlamacppConfig {
    pub version_backend: String,
    pub auto_update_engine: bool,
    pub auto_unload: bool,
    pub timeout: i32,
    pub llamacpp_env: String,
    pub memory_util: String,
    pub chat_template: String,
    pub n_gpu_layers: i32,
    pub offload_mmproj: bool,
    pub cpu_moe: bool,
    pub n_cpu_moe: i32,
    pub override_tensor_buffer_t: String,
    pub ctx_size: i32,
    pub threads: i32,
    pub threads_batch: i32,
    pub n_predict: i32,
    pub batch_size: i32,
    pub ubatch_size: i32,
    pub device: String,
    pub split_mode: String,
    pub main_gpu: i32,
    pub flash_attn: String,
    pub cont_batching: bool,
    pub no_mmap: bool,
    pub mlock: bool,
    pub no_kv_offload: bool,
    pub cache_type_k: String,
    pub cache_type_v: String,
    pub defrag_thold: f32,
    pub rope_scaling: String,
    pub rope_scale: f32,
    pub rope_freq_base: f32,
    pub rope_freq_scale: f32,
    pub ctx_shift: bool,
}

pub struct ArgumentBuilder {
    args: Vec<String>,
    config: LlamacppConfig,
    backend: String,
    is_embedding: bool,
}

impl ArgumentBuilder {
    pub fn new(config: LlamacppConfig, is_embedding: bool) -> Result<Self, String> {
        let backend = config
            .version_backend
            .split('/')
            .nth(1)
            .ok_or("Invalid version_backend format")?
            .to_string();

        Ok(Self {
            args: Vec::new(),
            config,
            backend,
            is_embedding,
        })
    }

    /// Build all arguments based on configuration
    pub fn build(
        mut self,
        model_id: &str,
        model_path: &str,
        port: u16,
        mmproj_path: Option<String>,
    ) -> Vec<String> {
        // Disable llama-server webui for non-ik backends
        if !self.backend.starts_with("ik") {
            self.args.push("--no-webui".to_string());
        }

        // Jinja template support
        self.args.push("--jinja".to_string());

        // Model path (required)
        self.args.push("-m".to_string());
        self.args.push(model_path.to_string());

        // CPU MOE settings
        self.add_cpu_moe_args();

        // Tensor buffer override
        self.add_tensor_buffer_override();

        // Multimodal projector settings
        self.add_mmproj_args(mmproj_path);

        // Model alias and port
        self.args.push("-a".to_string());
        self.args.push(model_id.to_string());
        self.args.push("--port".to_string());
        self.args.push(port.to_string());

        // Chat template
        self.add_chat_template();

        // GPU layers
        self.add_gpu_layers();

        // Thread settings
        self.add_thread_settings();

        // Batch settings
        self.add_batch_settings();

        // Device and split mode
        self.add_device_settings();

        // Flash attention
        self.add_flash_attention();

        // Boolean flags
        self.add_boolean_flags();

        // Embedding vs text generation specific args
        if self.is_embedding {
            self.add_embedding_args();
        } else {
            self.add_text_generation_args();
        }

        self.args
    }

    fn add_cpu_moe_args(&mut self) {
        if self.config.cpu_moe {
            self.args.push("--cpu-moe".to_string());
        }

        if self.config.n_cpu_moe > 0 {
            self.args.push("--n-cpu-moe".to_string());
            self.args.push(self.config.n_cpu_moe.to_string());
        }
    }

    fn add_tensor_buffer_override(&mut self) {
        if !self.config.override_tensor_buffer_t.is_empty() {
            self.args.push("--override-tensor".to_string());
            self.args.push(self.config.override_tensor_buffer_t.clone());
        }
    }

    fn add_mmproj_args(&mut self, mmproj_path: Option<String>) {
        if let Some(path) = mmproj_path.filter(|p| !p.is_empty()) {
            self.args.push("--mmproj".to_string());
            self.args.push(path);
        }
    }

    fn add_chat_template(&mut self) {
        if !self.config.chat_template.is_empty() {
            self.args.push("--chat-template".to_string());
            self.args.push(self.config.chat_template.clone());
        }
    }

    fn add_gpu_layers(&mut self) {
        let gpu_layers = if self.config.n_gpu_layers >= 0 {
            self.config.n_gpu_layers
        } else {
            100
        };
        self.args.push("-ngl".to_string());
        self.args.push(gpu_layers.to_string());
    }

    fn add_thread_settings(&mut self) {
        if self.config.threads > 0 {
            self.args.push("--threads".to_string());
            self.args.push(self.config.threads.to_string());
        }

        if self.config.threads_batch > 0 {
            self.args.push("--threads-batch".to_string());
            self.args.push(self.config.threads_batch.to_string());
        }
    }

    fn add_batch_settings(&mut self) {
        if self.config.batch_size > 0 {
            self.args.push("--batch-size".to_string());
            self.args.push(self.config.batch_size.to_string());
        }

        if self.config.ubatch_size > 0 {
            self.args.push("--ubatch-size".to_string());
            self.args.push(self.config.ubatch_size.to_string());
        }
    }

    fn add_device_settings(&mut self) {
        if !self.config.device.is_empty() {
            self.args.push("--device".to_string());
            self.args.push(self.config.device.clone());
        }

        if !self.config.split_mode.is_empty() && self.config.split_mode != "layer" {
            self.args.push("--split-mode".to_string());
            self.args.push(self.config.split_mode.clone());
        }

        if self.config.main_gpu != 0 {
            self.args.push("--main-gpu".to_string());
            self.args.push(self.config.main_gpu.to_string());
        }
    }

    fn add_flash_attention(&mut self) {
        if self.backend.starts_with("ik") {
            // ik fork uses old -fa flag
            if self.config.flash_attn == "on" {
                self.args.push("-fa".to_string());
            }
        } else if !self.config.flash_attn.is_empty() && self.config.flash_attn != "auto" {
            // Standard llama.cpp uses --flash-attn
            self.args.push("--flash-attn".to_string());
            self.args.push(self.config.flash_attn.clone());
        }
    }

    fn add_boolean_flags(&mut self) {
        if self.config.ctx_shift {
            self.args.push("--context-shift".to_string());
        }

        if self.config.cont_batching {
            self.args.push("--cont-batching".to_string());
        }

        if self.config.no_mmap {
            self.args.push("--no-mmap".to_string());
        }

        if self.config.mlock {
            self.args.push("--mlock".to_string());
        }

        if self.config.no_kv_offload {
            self.args.push("--no-kv-offload".to_string());
        }
    }

    fn add_embedding_args(&mut self) {
        self.args.push("--embedding".to_string());
        self.args.push("--pooling".to_string());
        self.args.push("mean".to_string());
    }

    fn add_text_generation_args(&mut self) {
        if self.config.ctx_size > 0 {
            self.args.push("--ctx-size".to_string());
            self.args.push(self.config.ctx_size.to_string());
        }

        if self.config.n_predict > 0 {
            self.args.push("--n-predict".to_string());
            self.args.push(self.config.n_predict.to_string());
        }

        if !self.config.cache_type_k.is_empty() && self.config.cache_type_k != "f16" {
            self.args.push("--cache-type-k".to_string());
            self.args.push(self.config.cache_type_k.clone());
        }

        // cache_type_v only if flash_attn is 'on' and value is not f16/f32
        if self.config.flash_attn == "on"
            && !self.config.cache_type_v.is_empty()
            && self.config.cache_type_v != "f16"
            && self.config.cache_type_v != "f32"
        {
            self.args.push("--cache-type-v".to_string());
            self.args.push(self.config.cache_type_v.clone());
        }

        if (self.config.defrag_thold - 0.1).abs() > f32::EPSILON {
            self.args.push("--defrag-thold".to_string());
            self.args.push(self.config.defrag_thold.to_string());
        }

        self.add_rope_settings();
    }

    fn add_rope_settings(&mut self) {
        if !self.config.rope_scaling.is_empty() && self.config.rope_scaling != "none" {
            self.args.push("--rope-scaling".to_string());
            self.args.push(self.config.rope_scaling.clone());
        }

        if (self.config.rope_scale - 1.0).abs() > f32::EPSILON {
            self.args.push("--rope-scale".to_string());
            self.args.push(self.config.rope_scale.to_string());
        }

        if self.config.rope_freq_base != 0.0 {
            self.args.push("--rope-freq-base".to_string());
            self.args.push(self.config.rope_freq_base.to_string());
        }

        if (self.config.rope_freq_scale - 1.0).abs() > f32::EPSILON {
            self.args.push("--rope-freq-scale".to_string());
            self.args.push(self.config.rope_freq_scale.to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_config() -> LlamacppConfig {
        LlamacppConfig {
            version_backend: "v1.0/standard".to_string(),
            auto_update_engine: false,
            auto_unload: false,
            timeout: 120,
            llamacpp_env: String::new(),
            memory_util: String::new(),
            chat_template: String::new(),
            n_gpu_layers: 100,
            offload_mmproj: true,
            cpu_moe: false,
            n_cpu_moe: 0,
            override_tensor_buffer_t: String::new(),
            ctx_size: 2048,
            threads: 0,
            threads_batch: 0,
            n_predict: 0,
            batch_size: 0,
            ubatch_size: 0,
            device: String::new(),
            split_mode: "layer".to_string(),
            main_gpu: 0,
            flash_attn: "auto".to_string(),
            cont_batching: false,
            no_mmap: false,
            mlock: false,
            no_kv_offload: false,
            cache_type_k: "f16".to_string(),
            cache_type_v: "f16".to_string(),
            defrag_thold: 0.1,
            rope_scaling: "none".to_string(),
            rope_scale: 1.0,
            rope_freq_base: 0.0,
            rope_freq_scale: 1.0,
            ctx_shift: false,
        }
    }

    #[test]
    fn test_basic_argument_building() {
        let mut config = default_config();
        config.n_gpu_layers = 32;
        config.threads = 4;
        config.ctx_size = 2048;

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test-model", "/path/to/model", 8080, None);

        assert!(args.contains(&"--no-webui".to_string()));
        assert!(args.contains(&"-m".to_string()));
        assert!(args.contains(&"--port".to_string()));
        assert!(args.contains(&"8080".to_string()));
    }

    #[test]
    fn test_embedding_mode() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, true).unwrap();
        let args = builder.build("embed-model", "/path/to/model", 8080, None);

        assert!(args.contains(&"--embedding".to_string()));
        assert!(args.contains(&"--pooling".to_string()));
        assert!(args.contains(&"mean".to_string()));
    }

    #[test]
    fn test_ik_backend_flash_attention() {
        let mut config = default_config();
        config.version_backend = "v1.0/ik-backend".to_string();
        config.flash_attn = "on".to_string();

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert!(args.contains(&"-fa".to_string()));
        assert!(!args.contains(&"--flash-attn".to_string()));
    }

    #[test]
    fn test_empty_strings_not_added() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        // Empty strings should not result in empty arguments
        assert!(!args.contains(&"--device".to_string()));
        assert!(!args.contains(&"--chat-template".to_string()));
        assert!(!args.contains(&"--override-tensor".to_string()));
    }
}
