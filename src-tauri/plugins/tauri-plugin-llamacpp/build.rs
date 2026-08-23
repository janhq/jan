//! Permission generation, plus the optional native llama.cpp engine build.
//!
//! The engine is behind the `engine` feature and OFF by default, deliberately:
//! this crate is a non-optional dependency of the app crate, so a `build.rs`
//! that always ran cmake would put a C++ toolchain on the critical path of
//! every `cargo check` -- including the CLI-only job, which never runs
//! inference. Enable it for real desktop builds.

// The pinned llama.cpp. `make engine-source` reads TAG and COMMIT straight out
// of this file and shallow-clones that tag, verifying HEAD against COMMIT -- a
// git tag is mutable, so the commit is what actually pins the build. Vendored
// at
// vendor/llama.cpp and with engine::PINNED_* on the Rust side; the shim
// re-exports llama_version()/llama_build_number() so a mismatch is caught at
// runtime instead of producing a silently wrong engine.
pub const LLAMA_CPP_TAG: &str = "b10582";
pub const LLAMA_CPP_BUILD_NUMBER: u32 = 10582;
pub const LLAMA_CPP_COMMIT: &str = "e85caa81ea2b65797396018c179b87ad61fa38ab";
pub const LLAMA_CPP_VERSION: &str = "0.2.0";

const COMMANDS: &[&str] = &[
    // Cleanup command
    "cleanup_llama_processes",
    // Model lifecycle, served by the engine worker over loopback HTTP
    "load_llama_model",
    "unload_llama_model",
    "generate_api_key",
    "ensure_session_ready",
    "find_session_by_model",
    "get_loaded_models",
    // The in-process engine worker, which replaced the spawned router and the
    // downloaded backend it used to run
    "start_engine",
    "stop_engine",
    "get_engine_info",
    "reload_engine_models",
    "engine_devices",
    "force_stop_engine",
    "engine_slots_idle",
    // GGUF commands
    "read_gguf_metadata",
    "is_model_supported",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();

    println!("cargo:rustc-env=JAN_LLAMA_CPP_TAG={LLAMA_CPP_TAG}");
    println!("cargo:rustc-env=JAN_LLAMA_CPP_BUILD_NUMBER={LLAMA_CPP_BUILD_NUMBER}");
    println!("cargo:rustc-env=JAN_LLAMA_CPP_COMMIT={LLAMA_CPP_COMMIT}");
    println!("cargo:rustc-env=JAN_LLAMA_CPP_VERSION={LLAMA_CPP_VERSION}");

    // Features reach a build script only as CARGO_FEATURE_* env vars -- a
    // `#[cfg(feature = ...)]` here would silently never fire.
    if std::env::var_os("CARGO_FEATURE_ENGINE").is_some() {
        engine::build();
    }
}

mod engine {
    use std::path::{Path, PathBuf};
    use std::{env, fs, process::Command};

    use super::{LLAMA_CPP_BUILD_NUMBER, LLAMA_CPP_COMMIT, LLAMA_CPP_TAG};

    /// Static archives from stage 2, in the order the linker group needs them
    /// declared. server-context <-> llama-common <-> mtmd have circular
    /// references, so they go inside one --start-group rather than being
    /// ordered by hand. No ggml here: stage 1 builds it shared.
    const ARCHIVES: &[&str] = &[
        "jan_llama_shim",
        "server-context",
        "llama-common",
        "llama-common-base",
        "mtmd",
        "llama",
        "cpp-httplib",
        "vendor-hash",
    ];

    /// Where each archive lands under the stage 2 cmake build tree.
    const ARCHIVE_DIRS: &[&str] = &[
        "src",
        "common",
        "tools/server",
        "tools/mtmd",
        "vendor/cpp-httplib",
        "vendor/hash",
    ];

    /// ggml, linked as shared libraries from stage 1. The compute backends are
    /// *not* here: they are `MODULE` libraries loaded by name at runtime.
    const SHARED_LIBS: &[&str] = &["ggml", "ggml-base"];

    /// GPU backends, as (cargo feature, ggml cmake flag). These belong to
    /// stage 1 because they are ggml backend modules.
    const GPU_BACKENDS: &[(&str, &str)] = &[
        ("engine-cuda", "-DGGML_CUDA=ON"),
        ("engine-vulkan", "-DGGML_VULKAN=ON"),
        ("engine-hip", "-DGGML_HIP=ON"),
        ("engine-metal", "-DGGML_METAL=ON"),
    ];

    pub fn build() {
        println!("cargo:rerun-if-changed=shim/jan_llama_shim.cpp");
        println!("cargo:rerun-if-changed=shim/jan_llama_shim.h");
        println!("cargo:rerun-if-env-changed=JAN_LLAMA_PREBUILT_DIR");
        println!("cargo:rerun-if-env-changed=JAN_LLAMA_CPP_DIR");
        println!("cargo:rerun-if-env-changed=JAN_ENGINE_CUDA_ARCHS");
        println!("cargo:rerun-if-env-changed=JAN_ENGINE_BUILD_LOG");

        // Headers are always needed: the shim is our code and is compiled
        // here even when the archives come prebuilt, so it cannot drift from
        // the crate.
        let src = source_dir();

        // Prebuilt path: a matrix job compiled both stages once and published
        // them, so the app build only links. No network, no cmake, no nvcc.
        // Layout is `lib/` (stage 2 .a plus stage 1 ggml shared libs),
        // `include/` (llama.cpp's *generated* headers, e.g. build-info.h) and
        // `backends/` (the runtime-loaded ggml modules).
        let (mut search_dirs, generated_include, backend_dir) =
            if let Ok(dir) = env::var("JAN_LLAMA_PREBUILT_DIR") {
                let dir = PathBuf::from(dir);
                let lib = dir.join("lib");
                let inc = dir.join("include");
                assert!(
                    lib.is_dir() && inc.is_dir(),
                    "JAN_LLAMA_PREBUILT_DIR={} must contain lib/ and include/",
                    dir.display()
                );
                (vec![lib], inc, dir.join("backends"))
            } else {
                let ggml = build_ggml(&src);
                let llama = build_llama(&src, &ggml);
                let mut dirs = ARCHIVE_DIRS
                    .iter()
                    .map(|d| llama.join(d))
                    .collect::<Vec<_>>();
                dirs.push(ggml.join("lib"));
                (dirs, llama, ggml.join("bin"))
            };

        search_dirs.push(compile_shim(&src, &generated_include));
        emit_link_flags(&search_dirs);

        // ggml resolves backend modules against the *executable's* directory
        // (ggml-backend-reg.cpp:492), which is where packaging puts them. A
        // `cargo run`/`cargo test` binary has no such neighbours, so the worker
        // falls back to this path via GGML_BACKEND_PATH.
        println!(
            "cargo:rustc-env=JAN_GGML_BACKEND_DIR={}",
            backend_dir.display()
        );
    }

    /// Stage 1: ggml as shared libraries with runtime-loaded backend modules.
    ///
    /// Separate from stage 2 because `GGML_CPU_ALL_VARIANTS` requires
    /// `GGML_BACKEND_DL`, which requires `BUILD_SHARED_LIBS`
    /// (ggml/src/CMakeLists.txt:188-190 and :485-487, both hard errors) --
    /// while we still want a *static* libllama/libcommon/server-context. Two
    /// configures is the only way to have both.
    ///
    /// Driven through a generated wrapper project rather than `-S <src>/ggml`:
    /// configuring ggml as the top-level project sets `GGML_STANDALONE=ON`,
    /// which then requires `tests/`, `examples/` and `ggml.pc.in` that the
    /// copy vendored inside llama.cpp does not ship.
    fn build_ggml(src: &Path) -> PathBuf {
        let out = PathBuf::from(env::var("OUT_DIR").unwrap());
        let wrapper = out.join("ggml-project");
        let build = out.join("ggml-build");
        let prefix = out.join("ggml-prefix");
        fs::create_dir_all(&wrapper).expect("could not create the ggml wrapper dir");
        fs::write(
            wrapper.join("CMakeLists.txt"),
            "cmake_minimum_required(VERSION 3.14)\n\
             project(jan_ggml C CXX ASM)\n\
             add_subdirectory(${JAN_GGML_SRC} ggml)\n",
        )
        .expect("could not write the ggml wrapper project");

        // The wrapper is regenerated each run, so its own path never changes;
        // what changes is JAN_GGML_SRC inside it. A cache holding a different
        // value would silently keep building the old tree, so key off that.
        discard_stale_ggml_cache(&build, &src.join("ggml"));

        let mut cfg = Command::new("cmake");
        cfg.arg("-S").arg(&wrapper).arg("-B").arg(&build);
        cfg.arg(format!(
            "-DJAN_GGML_SRC={}",
            src.join("ggml").display()
        ));
        cfg.arg(format!("-DCMAKE_INSTALL_PREFIX={}", prefix.display()));
        cfg.args([
            "-DCMAKE_BUILD_TYPE=Release",
            "-DCMAKE_POSITION_INDEPENDENT_CODE=ON",
            "-DBUILD_SHARED_LIBS=ON",
            "-DGGML_BACKEND_DL=ON",
            // Deterministic across machines: the per-microarchitecture choice
            // is made at runtime by ggml_backend_score, not at compile time.
            "-DGGML_NATIVE=OFF",
            // Default is already ON, but passed explicitly so a value cached by
            // an earlier configure cannot silently disable caching -- the
            // difference on a CUDA rebuild is minutes versus tens of minutes.
            // ggml picks up ccache or sccache, whichever it finds.
            "-DGGML_CCACHE=ON",
        ]);
        if cpu_all_variants_supported() {
            cfg.arg("-DGGML_CPU_ALL_VARIANTS=ON");
        }
        for (feature, flag) in GPU_BACKENDS {
            if feature_enabled(feature) {
                cfg.arg(flag);
            }
        }
        // Upstream picks CMAKE_CUDA_ARCHITECTURES itself, but only when it is
        // undefined, and its default list (75/80/86/89/90, plus 50/61/70 below
        // CUDA 13 and 120a from 12.8) covers discrete desktop and datacenter
        // parts only. It has no Jetson entry: Orin is sm_87 and Xavier sm_72,
        // neither of which is in that list, and on CUDA 13 the lowest virtual
        // arch is 75, which cannot JIT down to 72. So an ARM/Jetson build needs
        // to say what it targets -- and trimming to a single known arch is also
        // how you cut a CUDA worker's size for a fixed fleet.
        if let Ok(archs) = env::var("JAN_ENGINE_CUDA_ARCHS") {
            let archs = archs.trim();
            if !archs.is_empty() {
                println!("cargo:rerun-if-env-changed=JAN_ENGINE_CUDA_ARCHS");
                cfg.arg(format!("-DCMAKE_CUDA_ARCHITECTURES={archs}"));
            }
        }
        if feature_enabled("engine-cuda") {
            // NCCL is multi-GPU collective communication for distributed
            // inference. It is found opportunistically and defaults ON
            // (ggml/CMakeLists.txt:210), which would make the shipped
            // ggml-cuda module depend on whatever libnccl the build host
            // happened to have.
            cfg.arg("-DGGML_CUDA_NCCL=OFF");
        }
        run(&mut cfg, "cmake configure (ggml)");

        let mut bld = Command::new("cmake");
        bld.arg("--build").arg(&build);
        if let Ok(jobs) = env::var("NUM_JOBS") {
            bld.arg("-j").arg(jobs);
        }
        run(&mut bld, "cmake build (ggml)");

        let mut inst = Command::new("cmake");
        inst.arg("--install").arg(&build);
        run(&mut inst, "cmake install (ggml)");

        prefix
    }

    /// Stage 2: everything above ggml, statically, against stage 1's ggml.
    fn build_llama(src: &Path, ggml_prefix: &Path) -> PathBuf {
        let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("llama-build");
        discard_foreign_cache(&out, src);
        fs::create_dir_all(&out).expect("could not create the cmake build dir");

        let mut cfg = Command::new("cmake");
        cfg.arg("-S").arg(src).arg("-B").arg(&out);
        cfg.arg(format!(
            "-DCMAKE_PREFIX_PATH={}",
            ggml_prefix.display()
        ));
        cfg.args([
            "-DCMAKE_BUILD_TYPE=Release",
            "-DCMAKE_POSITION_INDEPENDENT_CODE=ON",
            // Static: libllama/libcommon/server-context link into our binary.
            // server-context is declared STATIC upstream regardless
            // (tools/server/CMakeLists.txt:5-7), but libllama and libcommon
            // follow this flag.
            "-DBUILD_SHARED_LIBS=OFF",
            // Use stage 1's ggml instead of building a second, static one
            // (CMakeLists.txt:204-208 -> find_package(ggml REQUIRED)).
            "-DLLAMA_USE_SYSTEM_GGML=ON",
            "-DLLAMA_BUILD_TESTS=OFF",
            "-DLLAMA_BUILD_EXAMPLES=OFF",
            "-DLLAMA_BUILD_APP=OFF",
            "-DLLAMA_BUILD_SERVER=ON",
            "-DLLAMA_BUILD_TOOLS=ON",
            "-DLLAMA_BUILD_COMMON=ON",
            // We drive server_routes directly, so the bundled web UI is dead
            // weight -- and LLAMA_USE_PREBUILT_UI would fetch from HuggingFace
            // during configure.
            "-DLLAMA_BUILD_UI=OFF",
            "-DLLAMA_USE_PREBUILT_UI=OFF",
            // Router mode is the only consumer of subprocess spawning, and we
            // replace router mode with an in-process registry.
            "-DLLAMA_SUBPROCESS=OFF",
            // mtmd's video path fork/execs ffmpeg.
            "-DMTMD_VIDEO=OFF",
            "-DGGML_NATIVE=OFF",
            "-DLLAMA_BUILD_IS_DEV=OFF",
        ]);
        cfg.arg(format!("-DLLAMA_BUILD_NUMBER={LLAMA_CPP_BUILD_NUMBER}"));
        cfg.arg(format!("-DLLAMA_BUILD_COMMIT={LLAMA_CPP_COMMIT}"));
        run(&mut cfg, "cmake configure (llama)");

        let mut bld = Command::new("cmake");
        bld.arg("--build").arg(&out).arg("--target").arg("server-context");
        if let Ok(jobs) = env::var("NUM_JOBS") {
            bld.arg("-j").arg(jobs);
        }
        run(&mut bld, "cmake build (llama)");

        out
    }

    /// Removes a cmake build tree whose cache was generated from a different
    /// source directory.
    ///
    /// The build dir is keyed only by OUT_DIR, so switching between the
    /// vendored clone and a `JAN_LLAMA_CPP_DIR` checkout leaves a cache
    /// pointing at the old tree, and cmake then hard-fails with "does not match
    /// the source used to generate cache". Wiping is safe: everything in there
    /// is derived.
    fn discard_foreign_cache(build_dir: &Path, src: &Path) {
        let cache = build_dir.join("CMakeCache.txt");
        let Ok(text) = fs::read_to_string(&cache) else {
            return;
        };
        let home = text
            .lines()
            .find_map(|l| l.strip_prefix("CMAKE_HOME_DIRECTORY:INTERNAL="))
            .map(str::trim);
        let Some(home) = home else { return };

        // Compare canonically: OUT_DIR paths and the source can both contain
        // symlinks, and a spurious mismatch would rebuild llama.cpp every time.
        let same = fs::canonicalize(home)
            .ok()
            .zip(fs::canonicalize(src).ok())
            .map(|(a, b)| a == b)
            .unwrap_or(false);
        if !same {
            println!(
                "cargo:warning=llama.cpp source changed ({home} -> {}); discarding the cmake cache",
                src.display()
            );
            let _ = fs::remove_dir_all(build_dir);
        }
    }

    /// Same idea as `discard_foreign_cache`, but stage 1's cache home is the
    /// generated wrapper (whose path is stable), so the value that identifies
    /// the source is the cached `JAN_GGML_SRC`.
    fn discard_stale_ggml_cache(build_dir: &Path, ggml_src: &Path) {
        let cache = build_dir.join("CMakeCache.txt");
        let Ok(text) = fs::read_to_string(&cache) else {
            return;
        };
        let cached = text
            .lines()
            .find_map(|l| l.split_once("JAN_GGML_SRC:").and_then(|(_, r)| r.split_once('=')))
            .map(|(_, v)| v.trim().to_string());
        let Some(cached) = cached else { return };

        let same = fs::canonicalize(&cached)
            .ok()
            .zip(fs::canonicalize(ggml_src).ok())
            .map(|(a, b)| a == b)
            .unwrap_or(false);
        if !same {
            println!(
                "cargo:warning=ggml source changed ({cached} -> {}); discarding the cmake cache",
                ggml_src.display()
            );
            let _ = fs::remove_dir_all(build_dir);
        }
    }

    fn feature_enabled(feature: &str) -> bool {
        env::var_os(format!(
            "CARGO_FEATURE_{}",
            feature.to_uppercase().replace('-', "_")
        ))
        .is_some()
    }

    /// `GGML_CPU_ALL_VARIANTS` hard-errors on architectures it has no variant
    /// table for (ggml/src/CMakeLists.txt:581), so it is opt-in per arch rather
    /// than unconditional.
    fn cpu_all_variants_supported() -> bool {
        matches!(
            env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default().as_str(),
            "x86_64" | "aarch64" | "riscv64"
        )
    }

    /// `JAN_LLAMA_CPP_DIR` overrides the vendored clone, which is what a
    /// llama.cpp contributor working against a local tree wants.
    fn source_dir() -> PathBuf {
        if let Ok(dir) = env::var("JAN_LLAMA_CPP_DIR") {
            return PathBuf::from(dir);
        }
        let vendored = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/llama.cpp");
        assert!(
            vendored.join("CMakeLists.txt").is_file(),
            "vendor/llama.cpp is empty -- run `make engine-source` to \
             shallow-clone {LLAMA_CPP_TAG}, or point JAN_LLAMA_CPP_DIR at an \
             existing checkout. (Looked in {})",
            vendored.display()
        );
        vendored
    }

    /// The shim is compiled with `cc` rather than added to llama.cpp's cmake
    /// tree so the vendored source stays untouched and bisectable.
    /// `generated_include` is where llama.cpp's generated headers live: the
    /// cmake build dir normally, or the prebuilt bundle's include/.
    fn compile_shim(src: &Path, generated_include: &Path) -> PathBuf {
        let mut cc = cc::Build::new();
        cc.cpp(true)
            .std("c++17")
            .file("shim/jan_llama_shim.cpp")
            .include("shim")
            .include(src.join("include"))
            .include(src.join("ggml/include"))
            .include(src.join("common"))
            .include(src.join("tools/server"))
            .include(src.join("tools/mtmd"))
            .include(src.join("vendor"))
            .include(src.join("vendor/nlohmann"))
            .include(generated_include)
            .include(generated_include.join("common"));
        cc.compile("jan_llama_shim");
        PathBuf::from(env::var("OUT_DIR").unwrap())
    }

    fn emit_link_flags(dirs: &[PathBuf]) {
        for d in dirs {
            println!("cargo:rustc-link-search=native={}", d.display());
        }
        // One group: the archives reference each other cyclically.
        println!("cargo:rustc-link-arg=-Wl,--start-group");
        for a in ARCHIVES {
            println!("cargo:rustc-link-arg=-l{a}");
        }
        println!("cargo:rustc-link-arg=-Wl,--end-group");

        // ggml is shared now, so it links normally rather than into the group.
        for l in SHARED_LIBS {
            println!("cargo:rustc-link-lib=dylib={l}");
        }

        let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
        match target_os.as_str() {
            "macos" | "ios" => {
                println!("cargo:rustc-link-lib=dylib=c++");
                for fw in ["Accelerate", "Foundation", "Metal", "MetalKit"] {
                    println!("cargo:rustc-link-lib=framework={fw}");
                }
                // Shipped beside the binary; @loader_path keeps the bundle
                // relocatable, which an absolute build path would not.
                println!("cargo:rustc-link-arg=-Wl,-rpath,@loader_path");
            }
            // Windows has no rpath: the loader searches the .exe's own
            // directory first, which is where packaging puts the DLLs.
            "windows" => {}
            _ => {
                for l in ["stdc++", "m", "pthread", "dl", "gomp"] {
                    println!("cargo:rustc-link-lib=dylib={l}");
                }
                println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN");
            }
        }

        // The build-tree ggml, so `cargo test` and `cargo run` link and run
        // without a copy step. Packaging overrides this by placing the real
        // libraries next to the executable, which $ORIGIN/@loader_path finds
        // first.
        for d in dirs {
            println!("cargo:rustc-link-arg=-Wl,-rpath,{}", d.display());
        }
    }

    /// Runs a build step, streaming its output to `JAN_ENGINE_BUILD_LOG` when set.
    ///
    /// Cargo captures a build script's stdout and stderr and only surfaces them
    /// if the script fails, so a cmake/nvcc run that takes fifteen minutes
    /// prints nothing at all -- the build looks hung. Writing to a path the
    /// caller chose lets the Makefile `tail -F` it for live progress.
    ///
    /// On failure the tail is echoed through `println!` so the reason still
    /// reaches cargo's own error output, which is the one place a developer is
    /// guaranteed to look.
    fn run(cmd: &mut Command, what: &str) {
        let log_path = env::var_os("JAN_ENGINE_BUILD_LOG").map(PathBuf::from);

        let status = match &log_path {
            Some(path) => {
                let file = fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(path)
                    .unwrap_or_else(|e| {
                        panic!("could not open {} for the build log: {e}", path.display())
                    });
                let err = file
                    .try_clone()
                    .expect("could not duplicate the build log handle");
                cmd.stdout(file).stderr(err).status()
            }
            None => cmd.status(),
        }
        .unwrap_or_else(|e| panic!("{what} could not start ({e}); is cmake installed?"));

        if status.success() {
            return;
        }
        if let Some(path) = &log_path {
            eprintln!("--- tail of {} ---", path.display());
            for line in tail(path, 60) {
                eprintln!("{line}");
            }
        }
        panic!("{what} failed with {status}");
    }

    /// The last `n` lines of a file, for a failure message. Reads the whole file
    /// because a cmake log is small next to what it took to produce.
    fn tail(path: &Path, n: usize) -> Vec<String> {
        let Ok(text) = fs::read_to_string(path) else {
            return Vec::new();
        };
        let lines: Vec<&str> = text.lines().collect();
        lines[lines.len().saturating_sub(n)..]
            .iter()
            .map(|s| s.to_string())
            .collect()
    }
}
