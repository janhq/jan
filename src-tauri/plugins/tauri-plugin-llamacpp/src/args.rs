use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlamacppConfig {
    pub version_backend: String,
    pub auto_update_engine: bool,
    pub auto_unload: bool,
    pub timeout: i32,
    pub llamacpp_env: String,
    pub fit: String,
    pub fit_target: String,
    pub fit_ctx: String,
    pub memory_util: String, // TODO: Remove after fit implementation
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
        // llama fit
        // forks like ik is not supported
        if !self.backend.starts_with("ik") {
            self.add_fit_settings();
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
        let gpu_layers = if self.config.n_gpu_layers >= 0 && self.config.n_gpu_layers != 100 {
            // 100 means load all layers
            self.config.n_gpu_layers
        } else {
            -1
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
        if self.config.batch_size > 0 && self.config.batch_size != 2048 {
            self.args.push("--batch-size".to_string());
            self.args.push(self.config.batch_size.to_string());
        }

        if self.config.ubatch_size > 0 && self.config.ubatch_size != 512 {
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
        if self.config.ctx_size > 0 && self.config.ctx_size != 8192 {
            // set only when default values change
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

    fn add_fit_settings(&mut self) {
        // Handle fit on/off
        if self.config.fit == "off" {
            self.args.push("--fit".to_string());
            self.args.push("off".to_string());
        } else if self.config.fit == "on" {
            self.args.push("--fit".to_string());
            self.args.push("on".to_string());
        }
        if self.config.fit == "on" {
            if !self.config.fit_ctx.is_empty() && self.config.fit_ctx != "4096" {
                self.args.push("--fit-ctx".to_string());
                self.args.push(self.config.fit_ctx.clone());
            }

            if !self.config.fit_target.is_empty() && self.config.fit_target != "1024" {
                self.args.push("--fit-target".to_string());
                self.args.push(self.config.fit_target.clone());
            }
        }
    }
}
// -- Tests
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
            fit: String::new(),
            fit_ctx: String::new(),
            fit_target: String::new(),
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

    fn assert_arg_pair(args: &[String], flag: &str, value: &str) {
        let pos = args
            .iter()
            .position(|arg| arg == flag)
            .unwrap_or_else(|| panic!("Flag '{}' not found in args: {:?}", flag, args));
        assert_eq!(
            args.get(pos + 1).unwrap(),
            value,
            "Expected '{}' after flag '{}', but got '{:?}'",
            value,
            flag,
            args.get(pos + 1)
        );
    }

    fn assert_has_flag(args: &[String], flag: &str) {
        assert!(
            args.contains(&flag.to_string()),
            "Flag '{}' not found in args: {:?}",
            flag,
            args
        );
    }

    fn assert_no_flag(args: &[String], flag: &str) {
        assert!(
            !args.contains(&flag.to_string()),
            "Flag '{}' should not be present in args: {:?}",
            flag,
            args
        );
    }

    #[test]
    fn test_basic_required_arguments() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test-model", "/path/to/model", 8080, None);

        assert_has_flag(&args, "--no-webui");
        assert_has_flag(&args, "--jinja");
        assert_arg_pair(&args, "-m", "/path/to/model");
        assert_arg_pair(&args, "-a", "test-model");
        assert_arg_pair(&args, "--port", "8080");
    }

    #[test]
    fn test_gpu_layers_default_100() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "-ngl", "-1");
    }

    #[test]
    fn test_gpu_layers_custom_value() {
        let mut config = default_config();
        config.n_gpu_layers = 32;

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "-ngl", "32");
    }

    #[test]
    fn test_gpu_layers_negative_value() {
        let mut config = default_config();
        config.n_gpu_layers = -1;

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "-ngl", "-1");
    }

    #[test]
    fn test_embedding_mode_arguments() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, true).unwrap();
        let args = builder.build("embed-model", "/path/to/model", 8080, None);

        assert_has_flag(&args, "--embedding");
        assert_arg_pair(&args, "--pooling", "mean");
    }

    #[test]
    fn test_text_generation_mode_no_embedding_flags() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--embedding");
        assert_no_flag(&args, "--pooling");
    }

    #[test]
    fn test_thread_settings() {
        let mut config = default_config();
        config.threads = 8;
        config.threads_batch = 4;

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "--threads", "8");
        assert_arg_pair(&args, "--threads-batch", "4");
    }

    #[test]
    fn test_thread_settings_zero_not_added() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--threads");
        assert_no_flag(&args, "--threads-batch");
    }

    #[test]
    fn test_batch_settings_default_values_not_added() {
        let mut config = default_config();
        config.batch_size = 2048;
        config.ubatch_size = 512;

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--batch-size");
        assert_no_flag(&args, "--ubatch-size");
    }

    #[test]
    fn test_batch_settings_custom_values() {
        let mut config = default_config();
        config.batch_size = 1024;
        config.ubatch_size = 256;

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "--batch-size", "1024");
        assert_arg_pair(&args, "--ubatch-size", "256");
    }

    #[test]
    fn test_ik_backend_no_webui_flag() {
        let mut config = default_config();
        config.version_backend = "v1.0/ik-backend".to_string();

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--no-webui");
    }

    #[test]
    fn test_standard_backend_flash_attention() {
        let mut config = default_config();
        config.flash_attn = "on".to_string();

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "--flash-attn", "on");
        assert_no_flag(&args, "-fa");
    }

    #[test]
    fn test_ik_backend_flash_attention() {
        let mut config = default_config();
        config.version_backend = "v1.0/ik-backend".to_string();
        config.flash_attn = "on".to_string();

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_has_flag(&args, "-fa");
        assert_no_flag(&args, "--flash-attn");
    }

    #[test]
    fn test_flash_attention_auto_not_added() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--flash-attn");
    }

    #[test]
    fn test_cpu_moe_flags() {
        let mut config = default_config();
        config.cpu_moe = true;
        config.n_cpu_moe = 4;

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_has_flag(&args, "--cpu-moe");
        assert_arg_pair(&args, "--n-cpu-moe", "4");
    }

    #[test]
    fn test_cpu_moe_zero_not_added() {
        let mut config = default_config();
        config.cpu_moe = false;
        config.n_cpu_moe = 0;

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--cpu-moe");
        assert_no_flag(&args, "--n-cpu-moe");
    }

    #[test]
    fn test_mmproj_path_provided() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, Some("/path/to/mmproj".to_string()));

        assert_arg_pair(&args, "--mmproj", "/path/to/mmproj");
    }

    #[test]
    fn test_mmproj_path_empty_not_added() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, Some(String::new()));

        assert_no_flag(&args, "--mmproj");
    }

    #[test]
    fn test_chat_template() {
        let mut config = default_config();
        config.chat_template = "custom-template".to_string();

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "--chat-template", "custom-template");
    }

    #[test]
    fn test_empty_chat_template_not_added() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--chat-template");
    }

    #[test]
    fn test_device_settings() {
        let mut config = default_config();
        config.device = "cuda:0".to_string();
        config.split_mode = "row".to_string();
        config.main_gpu = 1;

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "--device", "cuda:0");
        assert_arg_pair(&args, "--split-mode", "row");
        assert_arg_pair(&args, "--main-gpu", "1");
    }

    #[test]
    fn test_split_mode_layer_default_not_added() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--split-mode");
    }

    #[test]
    fn test_main_gpu_zero_not_added() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--main-gpu");
    }

    #[test]
    fn test_boolean_flags_enabled() {
        let mut config = default_config();
        config.ctx_shift = true;
        config.cont_batching = true;
        config.no_mmap = true;
        config.mlock = true;
        config.no_kv_offload = true;

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_has_flag(&args, "--context-shift");
        assert_has_flag(&args, "--cont-batching");
        assert_has_flag(&args, "--no-mmap");
        assert_has_flag(&args, "--mlock");
        assert_has_flag(&args, "--no-kv-offload");
    }

    #[test]
    fn test_boolean_flags_disabled() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--context-shift");
        assert_no_flag(&args, "--cont-batching");
        assert_no_flag(&args, "--no-mmap");
        assert_no_flag(&args, "--mlock");
        assert_no_flag(&args, "--no-kv-offload");
    }

    #[test]
    fn test_ctx_size_default_not_added() {
        let mut config = default_config();
        config.ctx_size = 8192;

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--ctx-size");
    }

    #[test]
    fn test_ctx_size_custom_value() {
        let mut config = default_config();
        config.ctx_size = 4096;

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "--ctx-size", "4096");
    }

    #[test]
    fn test_n_predict() {
        let mut config = default_config();
        config.n_predict = 512;

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "--n-predict", "512");
    }

    #[test]
    fn test_cache_type_k_default_not_added() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--cache-type-k");
    }

    #[test]
    fn test_cache_type_k_custom_value() {
        let mut config = default_config();
        config.cache_type_k = "q8_0".to_string();

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "--cache-type-k", "q8_0");
    }

    #[test]
    fn test_cache_type_v_with_flash_attn() {
        let mut config = default_config();
        config.flash_attn = "on".to_string();
        config.cache_type_v = "q8_0".to_string();

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "--cache-type-v", "q8_0");
    }

    #[test]
    fn test_cache_type_v_without_flash_attn_not_added() {
        let mut config = default_config();
        config.flash_attn = "off".to_string();
        config.cache_type_v = "q8_0".to_string();

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--cache-type-v");
    }

    #[test]
    fn test_cache_type_v_f16_not_added() {
        let mut config = default_config();
        config.flash_attn = "on".to_string();
        config.cache_type_v = "f16".to_string();

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--cache-type-v");
    }

    #[test]
    fn test_defrag_thold_default_not_added() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--defrag-thold");
    }

    #[test]
    fn test_defrag_thold_custom_value() {
        let mut config = default_config();
        config.defrag_thold = 0.5;

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "--defrag-thold", "0.5");
    }

    #[test]
    fn test_rope_scaling_none_not_added() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--rope-scaling");
    }

    #[test]
    fn test_rope_scaling_custom_value() {
        let mut config = default_config();
        config.rope_scaling = "linear".to_string();

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "--rope-scaling", "linear");
    }

    #[test]
    fn test_rope_scale_default_not_added() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--rope-scale");
    }

    #[test]
    fn test_rope_scale_custom_value() {
        let mut config = default_config();
        config.rope_scale = 2.0;

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "--rope-scale", "2");
    }

    #[test]
    fn test_rope_freq_base_zero_not_added() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--rope-freq-base");
    }

    #[test]
    fn test_rope_freq_base_custom_value() {
        let mut config = default_config();
        config.rope_freq_base = 10000.0;

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "--rope-freq-base", "10000");
    }

    #[test]
    fn test_rope_freq_scale_default_not_added() {
        let config = default_config();
        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--rope-freq-scale");
    }

    #[test]
    fn test_rope_freq_scale_custom_value() {
        let mut config = default_config();
        config.rope_freq_scale = 0.5;

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "--rope-freq-scale", "0.5");
    }

    #[test]
    fn test_tensor_buffer_override() {
        let mut config = default_config();
        config.override_tensor_buffer_t = "f32".to_string();

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "--override-tensor", "f32");
    }

    #[test]
    fn test_fit_off() {
        let mut config = default_config();
        config.fit = "off".to_string();

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "--fit", "off");
        assert_no_flag(&args, "--fit-ctx");
        assert_no_flag(&args, "--fit-target");
    }

    #[test]
    fn test_fit_on_with_defaults() {
        let mut config = default_config();
        config.fit = "on".to_string();
        config.fit_ctx = "4096".to_string();
        config.fit_target = "1024".to_string();

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "--fit", "on");
        assert_no_flag(&args, "--fit-ctx");
        assert_no_flag(&args, "--fit-target");
    }

    #[test]
    fn test_fit_on_with_custom_values() {
        let mut config = default_config();
        config.fit = "on".to_string();
        config.fit_ctx = "8192".to_string();
        config.fit_target = "2048".to_string();

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_arg_pair(&args, "--fit", "on");
        assert_arg_pair(&args, "--fit-ctx", "8192");
        assert_arg_pair(&args, "--fit-target", "2048");
    }

    #[test]
    fn test_fit_not_added_for_ik_backend() {
        let mut config = default_config();
        config.version_backend = "v1.0/ik-backend".to_string();
        config.fit = "on".to_string();

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("test", "/path", 8080, None);

        assert_no_flag(&args, "--fit");
        assert_no_flag(&args, "--fit-ctx");
        assert_no_flag(&args, "--fit-target");
    }

    #[test]
    fn test_invalid_version_backend_format() {
        let mut config = default_config();
        config.version_backend = "invalid-format".to_string();

        let result = ArgumentBuilder::new(config, false);
        assert!(result.is_err());
        if let Err(e) = result {
            assert_eq!(e, "Invalid version_backend format");
        }
    }

    #[test]
    fn test_complex_configuration() {
        let mut config = default_config();
        config.n_gpu_layers = 50;
        config.threads = 16;
        config.threads_batch = 8;
        config.batch_size = 1024;
        config.ctx_size = 4096;
        config.flash_attn = "on".to_string();
        config.cont_batching = true;
        config.rope_scaling = "linear".to_string();
        config.rope_scale = 2.0;

        let builder = ArgumentBuilder::new(config, false).unwrap();
        let args = builder.build("complex-model", "/model/path", 9000, None);

        assert_arg_pair(&args, "-ngl", "50");
        assert_arg_pair(&args, "--threads", "16");
        assert_arg_pair(&args, "--threads-batch", "8");
        assert_arg_pair(&args, "--batch-size", "1024");
        assert_arg_pair(&args, "--ctx-size", "4096");
        assert_arg_pair(&args, "--flash-attn", "on");
        assert_has_flag(&args, "--cont-batching");
        assert_arg_pair(&args, "--rope-scaling", "linear");
        assert_arg_pair(&args, "--rope-scale", "2");
        assert_arg_pair(&args, "--port", "9000");
    }
}
