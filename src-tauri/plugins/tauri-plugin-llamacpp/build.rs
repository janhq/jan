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
pub const LLAMA_CPP_TAG: &str = "b10621";
pub const LLAMA_CPP_BUILD_NUMBER: u32 = 10621;
pub const LLAMA_CPP_COMMIT: &str = "c1d0e7a004015f23bc0233470b747b596f29b264";
pub const LLAMA_CPP_VERSION: &str = "0.3.0";

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
    "erase_thread_slot_state",
    // GGUF commands
    "read_gguf_metadata",
    "find_gguf_tensors",
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
    /// references, so on GNU ld they go inside one --start-group rather than
    /// being ordered by hand. No ggml here: stage 1 builds it shared.
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

    /// Windows needs a generator that is not Visual Studio, and a compiler
    /// named in the environment rather than found by one.
    ///
    /// ggml builds `vulkan-shaders-gen` as an `ExternalProject`, which
    /// reconfigures itself with the parent's generator *and nothing else* --
    /// verified from a generated `-cfgcmd.txt`, whose whole command line is the
    /// cache args the caller listed plus `-G<parent generator>`. Under the
    /// Visual Studio generator that child configure runs inside MSBuild, where
    /// it cannot identify a compiler at all ("The C compiler identification is
    /// unknown", then "No CMAKE_C_COMPILER could be found") and the engine
    /// build dies. Ninja keeps both configures flat and non-recursive, and
    /// `CC`/`CXX` reach the child because it inherits this environment -- the
    /// one channel ExternalProject cannot strip. clang-cl rather than cl
    /// because it locates the MSVC toolchain and Windows SDK itself, so no
    /// developer prompt is needed, while staying an MSVC-ABI, MSVC-naming
    /// compiler: the archives here link into a Rust `*-pc-windows-msvc` binary,
    /// which a GNU-driver clang would break by emitting `libllama.a`.
    fn windows_generator(cmd: &mut Command, src: &Path) {
        if env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() != "windows" {
            return;
        }
        if !on_path("ninja") {
            println!(
                "cargo:warning=ninja is not on PATH, so cmake will pick the Visual Studio \
                 generator, whose nested vulkan-shaders-gen configure cannot find a compiler"
            );
            return;
        }
        cmd.args(["-G", WINDOWS_GENERATOR]);
        // One per target arch, both clang. The arm64 file also pins
        // `-march=armv8.7-a`, upstream's baseline for its own ARM64 releases.
        let toolchain = if env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default() == "aarch64" {
            "cmake/arm64-windows-llvm.cmake"
        } else {
            "cmake/x64-windows-llvm.cmake"
        };
        cmd.arg(format!(
            "-DCMAKE_TOOLCHAIN_FILE={}",
            cmake_path(&src.join(toolchain))
        ));
        windows_cuda_host_compiler(cmd);
    }

    /// nvcc needs a host compiler for the non-device half of every `.cu`, and
    /// cmake infers it from the host arch -- wrong when the target is ARM64.
    /// Upstream's `cmake/arm64-windows-msvc-cuda.cmake` fixes that but leaves
    /// `CMAKE_C_COMPILER` unset, so C/C++ falls to `cl.exe`, which ggml-cpu
    /// rejects for ARM. So the clang toolchain file stays authoritative and
    /// only the CUDA host compiler is overridden here.
    ///
    /// `VCToolsInstallDir` is the arch-independent toolset root, set by any VS
    /// developer environment. Left alone when absent, so cmake reports the
    /// missing compiler rather than a path that does not exist.
    fn windows_cuda_host_compiler(cmd: &mut Command) {
        if env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default() != "aarch64" {
            return;
        }
        if !feature_enabled("engine-cuda") {
            return;
        }
        println!("cargo:rerun-if-env-changed=VCToolsInstallDir");
        let Ok(tools) = env::var("VCToolsInstallDir") else {
            println!(
                "cargo:warning=VCToolsInstallDir is unset, so cmake will guess the CUDA host \
                 compiler from the host arch; run from a Visual Studio developer prompt if the \
                 CUDA configure fails"
            );
            return;
        };
        // Probed, not assumed: ARM64 is reachable from either host.
        let root = PathBuf::from(tools);
        for host in ["Hostarm64", "Hostx64"] {
            let cl = root.join("bin").join(host).join("arm64").join("cl.exe");
            if cl.is_file() {
                cmd.arg(format!(
                    "-DCMAKE_CUDA_HOST_COMPILER={}",
                    cmake_path(&cl)
                ));
                return;
            }
        }
        println!(
            "cargo:warning=no arm64 cl.exe under {}/bin/Host*/arm64 -- install the MSVC ARM64 \
             toolset (Microsoft.VisualStudio.Component.VC.Tools.ARM64)",
            root.display()
        );
    }

    /// cmake takes forward slashes on every platform and treats a backslash as
    /// an escape in some contexts, so paths handed to `-D` go through here.
    fn cmake_path(p: &Path) -> String {
        p.display().to_string().replace('\\', "/")
    }

    fn on_path(exe: &str) -> bool {
        let Some(path) = env::var_os("PATH") else {
            return false;
        };
        env::split_paths(&path)
            .any(|dir| dir.join(exe).is_file() || dir.join(format!("{exe}.exe")).is_file())
    }

    /// upstream llama.cpp's own Windows recipe for this exact configuration
    /// (`GGML_BACKEND_DL` plus `GGML_CPU_ALL_VARIANTS`), down to the generator
    /// and toolchain file, and it is what its release job runs on this very
    /// image -- its ccache key says `windows-2025-vs2026`.
    ///
    /// Both halves are load-bearing. Ninja keeps the vulkan-shaders-gen
    /// ExternalProject out of MSBuild, which cannot identify a compiler when
    /// nested. The toolchain file sets `CMAKE_SYSTEM_NAME`, which makes
    /// `CMAKE_CROSSCOMPILING` true, which is what makes ggml generate a host
    /// toolchain and *pass it to that child* -- the only channel by which the
    /// child gets a compiler at all, since ExternalProject forwards nothing but
    /// the generator. It also selects clang's GNU driver, whose branch in
    /// ggml-cpu/CMakeLists.txt carries the per-variant `-mavxvnni` flags; the
    /// MSVC branch beside it only defines `__AVXVNNI__` and adds no flag, so
    /// clang-cl refused `_mm256_dpbusd_avx_epi32` in the alderlake variant.
    /// Artifact naming stays MSVC (`ggml.lib`, no `lib` prefix) because that
    /// follows the target, not the driver, which is what lets these archives
    /// link into a Rust `*-pc-windows-msvc` binary.
    const WINDOWS_GENERATOR: &str = "Ninja Multi-Config";

    /// The cmake configuration. Named on every build and install step, not
    /// just at configure time: a multi-config generator (Visual Studio, which
    /// is cmake's default on Windows) ignores CMAKE_BUILD_TYPE entirely and
    /// silently builds Debug, which links the non-redistributable debug CRT.
    /// The single-config generators accept the flag and ignore it.
    const CONFIG: &str = "Release";

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

    /// The GPUs a HIP build targets when JAN_ENGINE_HIP_TARGETS is unset: the
    /// list janhq/llama.cpp's menlo-build.yml shipped for the previous engine.
    /// Without an explicit list cmake asks `rocm_agent_enumerator`, which on a
    /// GPU-less build host yields nothing or the compiler's single default.
    const HIP_TARGETS: &str = "gfx908;gfx90a;gfx942;gfx1030;gfx1100;gfx1101;gfx1102;gfx1103;gfx1150;gfx1151;gfx1200;gfx1201";

    pub fn build() {
        println!("cargo:rerun-if-changed=shim/jan_llama_shim.cpp");
        println!("cargo:rerun-if-changed=shim/jan_llama_shim.h");
        println!("cargo:rerun-if-env-changed=JAN_LLAMA_PREBUILT_DIR");
        println!("cargo:rerun-if-env-changed=JAN_LLAMA_CPP_DIR");
        println!("cargo:rerun-if-env-changed=JAN_ENGINE_CUDA_ARCHS");
        println!("cargo:rerun-if-env-changed=JAN_ENGINE_HIP_TARGETS");
        println!("cargo:rerun-if-env-changed=JAN_ENGINE_BUILD_LOG");
        println!("cargo:rerun-if-env-changed=JAN_ENGINE_BUILD_DIR");

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
                let root = build_root();
                let ggml = build_ggml(&src, &root);
                let llama = build_llama(&src, &ggml, &root);
                let mut dirs = ARCHIVE_DIRS
                    .iter()
                    .map(|d| llama.join(d))
                    .collect::<Vec<_>>();
                // Visual Studio writes each target under its config; the
                // single-config generators write it where cmake was pointed.
                if env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() == "windows" {
                    dirs.extend(ARCHIVE_DIRS.iter().map(|d| llama.join(d).join(CONFIG)));
                }
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

    /// The deepest path a cmake build tree here creates, relative to the root
    /// the trees live under: nvcc's depfile for the longest-named CUDA
    /// template instance,
    /// `ggml-build/ggml/src/ggml-cuda/CMakeFiles/ggml-cuda.dir/Release/
    /// template-instances/fattn-mma-f16-instance-ncols1_1-ncols2_16.cu.obj.d`.
    /// Measured with a margin for upstream adding a longer instance name.
    const DEEPEST_BUILD_PATH: usize = 150;

    /// Written into OUT_DIR with the (possibly relocated) build root, so
    /// packaging can find the ggml prefix without repeating the logic below.
    const BUILD_ROOT_MARKER: &str = "engine-build-root.txt";

    /// Windows' classic MAX_PATH. nvcc (and parts of MSVC) still open files
    /// through the 260-char-limited API even when the OS has long paths
    /// enabled, so the limit is real regardless of registry settings.
    const WINDOWS_MAX_PATH: usize = 260;

    /// Where the cmake build trees go. Normally OUT_DIR -- but on Windows a
    /// cargo OUT_DIR (`...\target\release\build\tauri-plugin-llamacpp-<hash>\
    /// out`) is easily 130+ chars, and nvcc then dies with "Could not open
    /// output file ...fattn-...cu.obj.d" because the depfile crosses MAX_PATH.
    /// When that would happen, the trees move to a short per-OUT_DIR directory
    /// under %LOCALAPPDATA% instead. `JAN_ENGINE_BUILD_DIR` overrides the
    /// location outright, on every platform. Relocated trees are not removed
    /// by `cargo clean`.
    fn build_root() -> PathBuf {
        let out = PathBuf::from(env::var("OUT_DIR").unwrap());
        let root = resolve_build_root(&out);
        // Packaging (build-utils/stage-engine.sh) collects the ggml runtime
        // from the build trees and cannot guess a relocated root, so record it.
        fs::write(
            out.join(BUILD_ROOT_MARKER),
            root.to_string_lossy().as_bytes(),
        )
        .expect("could not record the engine build root");
        root
    }

    fn resolve_build_root(out: &Path) -> PathBuf {
        if let Ok(dir) = env::var("JAN_ENGINE_BUILD_DIR") {
            let dir = dir.trim();
            if !dir.is_empty() {
                let root = PathBuf::from(dir).join(out_dir_key(out));
                fs::create_dir_all(&root).expect("could not create JAN_ENGINE_BUILD_DIR");
                return root;
            }
        }
        if env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() != "windows" {
            return out.to_path_buf();
        }
        if out.as_os_str().len() + DEEPEST_BUILD_PATH < WINDOWS_MAX_PATH {
            return out.to_path_buf();
        }
        let base = env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| env::temp_dir());
        let root = base.join("jan-engine").join(out_dir_key(out));
        println!(
            "cargo:warning=OUT_DIR is too long for nvcc/cl on Windows \
             ({} chars); building llama.cpp under {} instead. Set \
             JAN_ENGINE_BUILD_DIR to choose the location.",
            out.as_os_str().len(),
            root.display()
        );
        fs::create_dir_all(&root).expect("could not create the short engine build dir");
        root
    }

    /// A stable short key for one OUT_DIR, so debug/release and per-feature
    /// builds relocated out of the target tree cannot share (and corrupt) one
    /// cmake cache. DefaultHasher::new() uses fixed keys, so the value is
    /// stable across runs.
    fn out_dir_key(out: &Path) -> String {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        out.hash(&mut h);
        format!("{:016x}", h.finish())
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
    fn build_ggml(src: &Path, root: &Path) -> PathBuf {
        let wrapper = root.join("ggml-project");
        let build = root.join("ggml-build");
        let prefix = root.join("ggml-prefix");
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

        // ggml builds vulkan-shaders-gen as an ExternalProject and, when
        // cross-compiling -- which the Windows toolchain file makes true --
        // hands it a host toolchain. Left to itself it runs `find_program(NAMES
        // cl gcc clang)`, and with no developer environment there is no `cl`,
        // so it settles on the GNU-driver clang: cmake then asks for a GNU
        // depfile, whose directory Ninja Multi-Config has not created, and the
        // child dies on `opening dependency file ...obj.d`. Naming an
        // MSVC-frontend compiler instead puts it back on /showIncludes, which
        // needs no such file -- and needs no vcvars either, since clang-cl
        // finds the MSVC headers and libraries by itself.
        let host_toolchain = root.join("vulkan-shaders-gen-host.cmake");
        if env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() == "windows" {
            fs::write(
                &host_toolchain,
                "set(CMAKE_BUILD_TYPE Release)\n\
                 set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)\n\
                 set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY NEVER)\n\
                 set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE NEVER)\n\
                 set(CMAKE_C_COMPILER clang-cl)\n\
                 set(CMAKE_CXX_COMPILER clang-cl)\n",
            )
            .expect("could not write the shader-generator host toolchain");
        }

        let mut cfg = Command::new("cmake");
        windows_generator(&mut cfg, src);
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
            // Upstream defaults are GGML_OPENMP=ON with GGML_OPENMP_FETCH=OFF,
            // and that pair links OpenMP into ggml-base and every CPU variant
            // while installing no runtime: the sole `install(FILES
            // ${GGML_OPENMP_RUNTIME})` rule sits inside the FETCH branch. On
            // Windows that shipped a hard import on a libomp.dll we never
            // staged, so every CPU backend failed to load on a machine without
            // LLVM -- silently, since release loading is silent=true. CI missed
            // it because the toolchain action puts LLVM's own libomp.dll on
            // PATH. FETCH=ON would fix it by downloading an LLVM installer and
            // extracting it with 7-Zip at configure time, which trades a silent
            // runtime break for a network dependency in the build; dropping
            // OpenMP costs some CPU threading throughput and nothing else.
            // Passed explicitly so a future upstream default cannot flip it
            // back unnoticed.
            "-DGGML_OPENMP=OFF",
            // Default is already ON, but passed explicitly so a value cached by
            // an earlier configure cannot silently disable caching -- the
            // difference on a CUDA rebuild is minutes versus tens of minutes.
            // ggml picks up ccache or sccache, whichever it finds.
            "-DGGML_CCACHE=ON",
        ]);
        // Every ggml library is staged into one directory, so each can find
        // its siblings from its own location. cmake otherwise strips the rpath
        // on install ("Set non-toolchain portion of runtime path to ''"),
        // leaving each backend module declaring a bare `libggml-base.so.0` that
        // nothing can resolve on its own: at runtime the worker has already
        // loaded it, but AppImage bundling reads these files cold and fails the
        // whole build on `Could not find dependency: libggml-base.so.0`.
        //
        // ELF only. macOS resolves this today through the worker's own
        // @loader_path and is left alone.
        if !matches!(
            env::var("CARGO_CFG_TARGET_OS").unwrap_or_default().as_str(),
            "macos" | "ios" | "windows"
        ) {
            cfg.arg("-DCMAKE_INSTALL_RPATH=$ORIGIN");
        }
        if host_toolchain.is_file() {
            cfg.arg(format!(
                "-DGGML_VULKAN_SHADERS_GEN_TOOLCHAIN={}",
                cmake_path(&host_toolchain)
            ));
        }
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
        if feature_enabled("engine-hip") {
            let targets = env::var("JAN_ENGINE_HIP_TARGETS").unwrap_or_default();
            let targets = targets.trim();
            let targets = if targets.is_empty() {
                HIP_TARGETS
            } else {
                targets
            };
            cfg.arg(format!("-DGPU_TARGETS={targets}"));
            // rocWMMA flash attention, as the previous engine shipped it; needs
            // rocwmma-dev, which check-engine-toolchain.sh asserts.
            cfg.arg("-DGGML_HIP_ROCWMMA_FATTN=ON");
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
        bld.arg("--build").arg(&build).args(["--config", CONFIG]);
        if let Ok(jobs) = env::var("NUM_JOBS") {
            bld.arg("-j").arg(jobs);
        }
        run(&mut bld, "cmake build (ggml)");

        let mut inst = Command::new("cmake");
        inst.arg("--install").arg(&build).args(["--config", CONFIG]);
        run(&mut inst, "cmake install (ggml)");

        prefix
    }

    /// Stage 2: everything above ggml, statically, against stage 1's ggml.
    fn build_llama(src: &Path, ggml_prefix: &Path, root: &Path) -> PathBuf {
        let out = root.join("llama-build");
        discard_foreign_cache(&out, src);
        fs::create_dir_all(&out).expect("could not create the cmake build dir");

        let mut cfg = Command::new("cmake");
        windows_generator(&mut cfg, src);
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
            // cpp-httplib's TLS, which only serves llama.cpp's own HTTPS model
            // downloads -- Jan fetches models in Rust and the worker listens on
            // loopback. On by default, and it puts OpenSSL symbols in an
            // archive nothing links an OpenSSL into: on Linux they resolve by
            // accident against the one reqwest already pulls in, on macOS,
            // where reqwest uses Security.framework, the link fails outright.
            "-DLLAMA_OPENSSL=OFF",
            "-DGGML_NATIVE=OFF",
            // Stage 1 owns the ggml libraries, but this tree still evaluates
            // ggml's option set, so the value is pinned on both sides rather
            // than left to depend on which branch runs here.
            "-DGGML_OPENMP=OFF",
            "-DLLAMA_BUILD_IS_DEV=OFF",
        ]);
        cfg.arg(format!("-DLLAMA_BUILD_NUMBER={LLAMA_CPP_BUILD_NUMBER}"));
        cfg.arg(format!("-DLLAMA_BUILD_COMMIT={LLAMA_CPP_COMMIT}"));
        run(&mut cfg, "cmake configure (llama)");

        let mut bld = Command::new("cmake");
        bld.arg("--build")
            .arg(&out)
            .args(["--config", CONFIG])
            .arg("--target")
            .arg("server-context");
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
    /// A build tree carries the generator it was configured with, and cmake
    /// refuses to reuse it under another one. Switching to Ninja on Windows
    /// would otherwise hard-fail on any tree an earlier Visual Studio configure
    /// left behind, which is every local Windows checkout built before that
    /// change.
    fn discard_other_generator(build_dir: &Path) {
        if env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() != "windows" {
            return;
        }
        let Ok(text) = fs::read_to_string(build_dir.join("CMakeCache.txt")) else {
            return;
        };
        let Some(cached) = text
            .lines()
            .find_map(|l| l.strip_prefix("CMAKE_GENERATOR:INTERNAL="))
            .map(str::trim)
        else {
            return;
        };
        let want = if on_path("ninja") { WINDOWS_GENERATOR } else { return };
        if cached != want {
            println!(
                "cargo:warning=cmake generator changed ({cached} -> {want}); discarding the cache"
            );
            let _ = fs::remove_dir_all(build_dir);
        }
    }

    fn discard_foreign_cache(build_dir: &Path, src: &Path) {
        discard_other_generator(build_dir);
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
        discard_other_generator(build_dir);
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
    ///
    /// The table is keyed on (arch, OS), not arch alone: the ARM branch covers
    /// Linux, Android and Apple only, so Windows hits the `FATAL_ERROR`.
    /// Opting out there is safe, not just quieter -- `GGML_BACKEND_DL` still
    /// yields one CPU backend as a loadable MODULE, which is what
    /// stage-engine.sh asserts. Cost is that one backend at the toolchain
    /// file's armv8.7-a baseline instead of a runtime-scored set.
    fn cpu_all_variants_supported() -> bool {
        let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
        let os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
        if arch == "aarch64" && os == "windows" {
            return false;
        }
        matches!(arch.as_str(), "x86_64" | "aarch64" | "riscv64")
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
        let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
        let gnu_ld = !matches!(target_os.as_str(), "macos" | "ios" | "windows");

        if gnu_ld {
            // One group: the archives reference each other cyclically.
            println!("cargo:rustc-link-arg=-Wl,--start-group");
            for a in ARCHIVES {
                println!("cargo:rustc-link-arg=-l{a}");
            }
            println!("cargo:rustc-link-arg=-Wl,--end-group");
        } else {
            // ld64 and link.exe re-scan archives until no undefined symbol is
            // left, so they resolve the cycle themselves and reject the group
            // flags outright.
            for a in ARCHIVES {
                println!("cargo:rustc-link-lib=static={a}");
            }
        }

        // ggml is shared now, so it links normally rather than into the group.
        for l in SHARED_LIBS {
            println!("cargo:rustc-link-lib=dylib={l}");
        }

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
        // first. Windows has no rpath at all.
        if target_os != "windows" {
            for d in dirs {
                println!("cargo:rustc-link-arg=-Wl,-rpath,{}", d.display());
            }
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

        // The directory is the caller's to name and need not exist yet -- the
        // Makefile points this at src-tauri/target, which the plugin's own
        // cargo build never creates. A log that cannot be opened costs progress
        // reporting, not the build, so fall back to inheriting stdio.
        let log = log_path.as_ref().and_then(|path| {
            if let Some(dir) = path.parent() {
                let _ = fs::create_dir_all(dir);
            }
            fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .map_err(|e| {
                    println!(
                        "cargo:warning=could not open {} for the build log: {e}",
                        path.display()
                    );
                })
                .ok()
        });

        let status = match log {
            Some(file) => {
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
            let text = fs::read_to_string(path).unwrap_or_default();
            // MSBuild interleaves the output of parallel targets, so the cause
            // is usually nowhere near the end the way it is under make.
            let errors = last_matching(&text, "error", 40);
            if !errors.is_empty() {
                eprintln!("--- error lines from {} ---", path.display());
                for line in errors {
                    eprintln!("{line}");
                }
            }
            eprintln!("--- tail of {} ---", path.display());
            for line in tail(&text, 60) {
                eprintln!("{line}");
            }
        }
        panic!("{what} failed with {status}");
    }

    /// The last `n` lines, for a failure message.
    fn tail(text: &str, n: usize) -> Vec<String> {
        let lines: Vec<&str> = text.lines().collect();
        lines[lines.len().saturating_sub(n)..]
            .iter()
            .map(|s| s.to_string())
            .collect()
    }

    /// The last `n` lines containing `needle`, case-insensitively. A cmake log
    /// is small next to what it took to produce, so this reads all of it.
    fn last_matching(text: &str, needle: &str, n: usize) -> Vec<String> {
        let mut hits: Vec<String> = text
            .lines()
            .filter(|l| l.to_ascii_lowercase().contains(needle))
            .map(|s| s.to_string())
            .collect();
        let drop = hits.len().saturating_sub(n);
        hits.drain(..drop);
        hits
    }
}
