//! Windows AppContainer confinement for the `bash` tool.
//!
//! AppContainer is a good fit for the policy [`super::jail`] describes, because
//! the three properties are close to its defaults rather than rules layered on
//! top:
//!
//! - reads: a lowbox token can only open objects whose DACL grants its package
//!   SID or one of its capabilities. Windows grants `ALL APPLICATION PACKAGES`
//!   read+execute on `C:\Windows` and `C:\Program Files` but not on user
//!   profiles, so "everything readable except the user's files" needs no rule.
//! - writes: nothing is writable until an ACE names the container, so granting
//!   one on the thread workspace is the whole write policy. The container also
//!   gets a private `AC\Temp` that Windows creates and ACLs for it.
//! - network: denied unless the spawn supplies the `internetClient` capability.
//!   AppContainer blocks loopback as well, which the Unix backends do not.
//!
//! Unlike bubblewrap and Seatbelt there is no argv to wrap: the confinement is a
//! token attribute passed to `CreateProcessW`, and `tokio::process::Command`
//! exposes no hook for `STARTUPINFOEX`. So this backend re-execs the running
//! binary as a helper ([`SANDBOX_EXEC_FLAG`]) that performs the confined spawn
//! and proxies the exit code, the same trick
//! `tauri_plugin_llamacpp::deps_analyzer` uses. The helper inherits its own std
//! handles down to the shell, so the parent's pipes still work unchanged --
//! inherited handles keep the access they were opened with, so the lowbox token
//! does not need rights on the pipes themselves.
//!
//! Codex confines Windows with restricted tokens plus a separate elevated
//! logon-user backend (`codex-rs/windows-sandbox-rs`, ~500KB across 40 files,
//! including WFP firewall rules and dedicated sandbox user accounts). That buys
//! deny-read ACEs and per-process network attribution we do not need: our policy
//! has a single writable root and a binary network switch, which AppContainer
//! expresses directly.

use std::path::{Path, PathBuf};

/// Marks a re-exec of this binary as the confined-spawn helper. Must be the
/// first argument, so a normal launch never looks at anything after it.
pub const SANDBOX_EXEC_FLAG: &str = "--internal-sandbox-exec";

const NET_ON: &str = "--net";
const NET_OFF: &str = "--no-net";

/// Exit code when the helper itself fails, distinct from anything a shell
/// reports so a setup failure is not mistaken for a command failure.
#[cfg(windows)]
const HELPER_FAILURE: i32 = 126;

/// FNV-1a. Only needs to be stable and well-spread; `DefaultHasher` is neither
/// guaranteed across releases nor reproducible by the helper on the other side
/// of the re-exec.
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// AppContainer moniker for one thread workspace. Derived rather than random so
/// the helper reaches the same container the previous command used, and
/// per-workspace so the SID that a workspace ACE grants cannot be held by a
/// command running for a different thread.
///
/// Monikers are limited to 64 characters of alphanumerics, `.`, `-` and `_`.
/// Windows paths are case-insensitive, so the case is folded before hashing to
/// keep two spellings of one workspace on one container.
pub fn moniker(workspace: &Path) -> String {
    let key = workspace.to_string_lossy().to_lowercase();
    format!("Jan.Agent.{:016x}", fnv1a(key.as_bytes()))
}

/// argv for the helper re-exec. Shaped like the other backends -- fixed
/// arguments, then the shell, with the command string appended by the caller --
/// so the spawn path does not change per platform.
pub fn helper_args(
    workspace: &Path,
    allow_network: bool,
    program: &Path,
    args: &[String],
) -> Vec<String> {
    let mut out = vec![
        SANDBOX_EXEC_FLAG.to_string(),
        if allow_network { NET_ON } else { NET_OFF }.to_string(),
        workspace.to_string_lossy().to_string(),
        "--".to_string(),
        program.to_string_lossy().to_string(),
    ];
    out.extend(args.iter().cloned());
    out
}

/// Quote one argument for `CreateProcessW`, which takes a single string and
/// leaves splitting to the callee. Follows the `CommandLineToArgvW` rules that
/// the C runtime and every mainstream shell parse with: backslashes are literal
/// except when they precede the closing quote, where they must be doubled.
#[cfg_attr(not(windows), allow(dead_code))]
fn quote_arg(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '"']) {
        return arg.to_string();
    }
    let mut out = String::with_capacity(arg.len() + 2);
    out.push('"');
    let mut backslashes = 0usize;
    for c in arg.chars() {
        match c {
            '\\' => {
                backslashes += 1;
                out.push('\\');
            }
            '"' => {
                // These backslashes now precede a quote, so they need escaping
                // too, or they would escape the quote instead of standing alone.
                out.push_str(&"\\".repeat(backslashes + 1));
                backslashes = 0;
                out.push('"');
            }
            other => {
                backslashes = 0;
                out.push(other);
            }
        }
    }
    out.push_str(&"\\".repeat(backslashes));
    out.push('"');
    out
}

/// Join a program and its arguments into a `CreateProcessW` command line.
#[cfg_attr(not(windows), allow(dead_code))]
fn command_line(program: &Path, args: &[String]) -> String {
    let mut line = quote_arg(&program.to_string_lossy());
    for a in args {
        line.push(' ');
        line.push_str(&quote_arg(a));
    }
    line
}

/// What the helper was asked to do, parsed from its own argv.
#[cfg_attr(not(windows), allow(dead_code))]
struct Request {
    workspace: PathBuf,
    allow_network: bool,
    program: PathBuf,
    args: Vec<String>,
}

/// Parse the helper's argv, or `None` when this process was not invoked as the
/// helper. Kept separate from the Win32 work so it is testable on any host.
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_request<I: IntoIterator<Item = String>>(argv: I) -> Option<Request> {
    let mut it = argv.into_iter();
    if it.next()? != SANDBOX_EXEC_FLAG {
        return None;
    }
    let allow_network = match it.next()?.as_str() {
        NET_ON => true,
        NET_OFF => false,
        _ => return None,
    };
    let workspace = PathBuf::from(it.next()?);
    if it.next()? != "--" {
        return None;
    }
    let program = PathBuf::from(it.next()?);
    Some(Request {
        workspace,
        allow_network,
        program,
        args: it.collect(),
    })
}

/// True when this host can build an AppContainer at all. On Windows this only
/// probes that the API exists (Windows 8 and later, and not a reimplementation
/// such as Wine); deriving a SID is a pure hash and touches nothing.
#[cfg(windows)]
pub fn available() -> bool {
    win::derive_sid("Jan.Agent.Probe").is_ok()
}

#[cfg(not(windows))]
pub fn available() -> bool {
    false
}

/// Discard the container a thread workspace was using. Called when the workspace
/// is deleted, so a finished conversation does not leave a registered profile and
/// an empty `AppData\Local\Packages` directory behind -- monikers are derived per
/// workspace, so nothing else would ever reuse it.
///
/// Best effort, and safe to call for a workspace that never ran a command. A
/// profile that outlives its workspace is litter rather than exposure: its SID is
/// only granted on a directory that no longer exists.
#[cfg(windows)]
pub fn release(workspace: &Path) {
    win::delete_profile(&moniker(workspace));
}

#[cfg(not(windows))]
pub fn release(_workspace: &Path) {}

/// Run the confined spawn and exit with the child's status, when this process
/// was re-exec'd as the helper. Returns immediately on a normal launch, so it is
/// safe (and required) to call first thing in `main`.
#[cfg(windows)]
pub fn run_helper_if_requested() {
    let Some(req) = parse_request(std::env::args().skip(1)) else {
        return;
    };
    match win::run(&req) {
        Ok(code) => std::process::exit(code),
        Err(message) => {
            eprintln!("ERROR: sandbox setup failed: {message}");
            std::process::exit(HELPER_FAILURE);
        }
    }
}

#[cfg(not(windows))]
pub fn run_helper_if_requested() {}

#[cfg(windows)]
mod win {
    use super::{command_line, moniker, Request};
    use std::ffi::{c_void, OsStr};
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    use windows_sys::core::{HRESULT, PWSTR};
    use windows_sys::Win32::Foundation::{
        CloseHandle, LocalFree, SetHandleInformation, ERROR_SUCCESS, HANDLE, HANDLE_FLAG_INHERIT,
        INVALID_HANDLE_VALUE, WAIT_FAILED,
    };
    use windows_sys::Win32::Security::Authorization::{
        GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W,
        GRANT_ACCESS, SE_FILE_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_WELL_KNOWN_GROUP, TRUSTEE_W,
    };
    use windows_sys::Win32::Security::Isolation::{
        CreateAppContainerProfile, DeleteAppContainerProfile,
        DeriveAppContainerSidFromAppContainerName,
    };
    use windows_sys::Win32::Security::{
        CreateWellKnownSid, FreeSid, WinCapabilityInternetClientSid, ACL, CONTAINER_INHERIT_ACE,
        DACL_SECURITY_INFORMATION, OBJECT_INHERIT_ACE, PSECURITY_DESCRIPTOR, PSID,
        SECURITY_CAPABILITIES, SECURITY_MAX_SID_SIZE, SID_AND_ATTRIBUTES,
    };
    use windows_sys::Win32::Storage::FileSystem::FILE_ALL_ACCESS;
    use windows_sys::Win32::System::Console::{
        GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
    };
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        CreateProcessW, DeleteProcThreadAttributeList, GetCurrentProcess, GetExitCodeProcess,
        InitializeProcThreadAttributeList, UpdateProcThreadAttribute, WaitForSingleObject,
        CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, INFINITE,
        LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION,
        PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, STARTF_USESTDHANDLES, STARTUPINFOEXW,
    };

    /// `HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)`: the profile survived a previous
    /// run, which is the normal case for a thread's second command.
    const PROFILE_EXISTS: HRESULT = -2147024713; // 0x800700B7

    fn wide(s: &OsStr) -> Vec<u16> {
        s.encode_wide().chain(std::iter::once(0)).collect()
    }

    fn last_error() -> String {
        std::io::Error::last_os_error().to_string()
    }

    /// Owns a `PSID` allocated by the isolation APIs.
    pub struct ContainerSid(PSID);

    impl Drop for ContainerSid {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { FreeSid(self.0) };
            }
        }
    }

    pub fn derive_sid(moniker: &str) -> Result<ContainerSid, String> {
        let name = wide(OsStr::new(moniker));
        let mut sid: PSID = std::ptr::null_mut();
        let hr = unsafe { DeriveAppContainerSidFromAppContainerName(name.as_ptr(), &mut sid) };
        if hr < 0 || sid.is_null() {
            return Err(format!(
                "could not derive an AppContainer SID (hr 0x{hr:08x})"
            ));
        }
        Ok(ContainerSid(sid))
    }

    /// Register the container profile if this is its first use, then return its
    /// SID. Capabilities are supplied per spawn instead of at creation, so the
    /// SID does not depend on whether network was allowed.
    fn ensure_profile(moniker: &str) -> Result<ContainerSid, String> {
        let name = wide(OsStr::new(moniker));
        let display = wide(OsStr::new("Jan agent tools"));
        let description = wide(OsStr::new("Sandbox for the Jan agent's shell tool"));
        let mut sid: PSID = std::ptr::null_mut();
        let hr = unsafe {
            CreateAppContainerProfile(
                name.as_ptr(),
                display.as_ptr(),
                description.as_ptr(),
                std::ptr::null_mut(),
                0,
                &mut sid,
            )
        };
        if hr >= 0 && !sid.is_null() {
            return Ok(ContainerSid(sid));
        }
        if hr == PROFILE_EXISTS {
            return derive_sid(moniker);
        }
        Err(format!(
            "could not create the AppContainer profile (hr 0x{hr:08x})"
        ))
    }

    pub fn delete_profile(moniker: &str) {
        let name = wide(OsStr::new(moniker));
        unsafe { DeleteAppContainerProfile(name.as_ptr()) };
    }

    /// Grant the container full access to `path` and everything created under it.
    /// This is the entire write policy: without an ACE naming the container, a
    /// lowbox token can open nothing it was not given.
    fn grant_workspace(path: &Path, sid: PSID) -> Result<(), String> {
        let mut object = wide(path.as_os_str());
        let mut existing: *mut ACL = std::ptr::null_mut();
        let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
        let status = unsafe {
            GetNamedSecurityInfoW(
                object.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut existing,
                std::ptr::null_mut(),
                &mut descriptor,
            )
        };
        if status != ERROR_SUCCESS {
            return Err(format!(
                "could not read the workspace ACL ({}): {}",
                path.display(),
                std::io::Error::from_raw_os_error(status as i32)
            ));
        }

        let access = EXPLICIT_ACCESS_W {
            grfAccessPermissions: FILE_ALL_ACCESS,
            grfAccessMode: GRANT_ACCESS,
            grfInheritance: CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE,
            Trustee: TRUSTEE_W {
                pMultipleTrustee: std::ptr::null_mut(),
                MultipleTrusteeOperation: 0,
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_WELL_KNOWN_GROUP,
                ptstrName: sid as PWSTR,
            },
        };
        let mut merged: *mut ACL = std::ptr::null_mut();
        // GRANT_ACCESS merges into the existing DACL rather than replacing it, so
        // the user keeps their own access to the workspace.
        let status = unsafe { SetEntriesInAclW(1, &access, existing, &mut merged) };
        if status != ERROR_SUCCESS {
            unsafe { LocalFree(descriptor) };
            return Err(format!(
                "could not build the workspace ACL: {}",
                std::io::Error::from_raw_os_error(status as i32)
            ));
        }

        let status = unsafe {
            SetNamedSecurityInfoW(
                object.as_mut_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                merged,
                std::ptr::null_mut(),
            )
        };
        unsafe {
            LocalFree(merged as *mut c_void);
            LocalFree(descriptor);
        }
        if status != ERROR_SUCCESS {
            return Err(format!(
                "could not apply the workspace ACL ({}): {}",
                path.display(),
                std::io::Error::from_raw_os_error(status as i32)
            ));
        }
        Ok(())
    }

    /// The `internetClient` capability, which is what makes outbound network calls
    /// possible at all for a lowbox token.
    fn internet_capability(buffer: &mut Vec<u8>) -> Result<SID_AND_ATTRIBUTES, String> {
        buffer.resize(SECURITY_MAX_SID_SIZE as usize, 0);
        let mut len = buffer.len() as u32;
        let ok = unsafe {
            CreateWellKnownSid(
                WinCapabilityInternetClientSid,
                std::ptr::null_mut(),
                buffer.as_mut_ptr() as PSID,
                &mut len,
            )
        };
        if ok == 0 {
            return Err(format!(
                "could not build the internetClient capability: {}",
                last_error()
            ));
        }
        Ok(SID_AND_ATTRIBUTES {
            Sid: buffer.as_mut_ptr() as PSID,
            Attributes: 0,
        })
    }

    /// Mark the std handles inheritable so the confined shell receives the
    /// parent's pipes. They arrive already usable: an inherited handle keeps the
    /// access it was opened with, so the lowbox token needs no rights on them.
    fn inheritable_std_handles() -> (HANDLE, HANDLE, HANDLE) {
        let mut handles = [INVALID_HANDLE_VALUE; 3];
        for (slot, id) in
            handles
                .iter_mut()
                .zip([STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE])
        {
            let handle = unsafe { GetStdHandle(id) };
            if !handle.is_null() && handle != INVALID_HANDLE_VALUE {
                unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) };
                *slot = handle;
            }
        }
        (handles[0], handles[1], handles[2])
    }

    /// Put this process in a kill-on-close job, so the shell -- created inside the
    /// job by inheritance -- dies whenever the helper does. `kill_on_drop` and
    /// `taskkill /T` reach the helper, not the extra process layer it adds, so
    /// without this a cancelled or timed-out command could leave a shell running.
    ///
    /// Best effort: a host that already confines us to a job it forbids nesting
    /// under should lose the reaping guarantee, not the tool.
    fn reap_children_with_this_process() {
        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if job.is_null() {
            return;
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let sized = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if sized == 0 {
            unsafe { CloseHandle(job) };
            return;
        }
        // The handle is deliberately leaked: the job must outlive this function
        // and close only when the process exits, which is what triggers the kill.
        unsafe { AssignProcessToJobObject(job, GetCurrentProcess()) };
    }

    /// Set up the container, then spawn the shell inside it and wait. Returns the
    /// shell's exit code so the helper is transparent to the caller.
    pub fn run(req: &Request) -> Result<i32, String> {
        if !req.workspace.is_dir() {
            return Err(format!(
                "workspace does not exist: {}",
                req.workspace.display()
            ));
        }
        reap_children_with_this_process();
        let sid = ensure_profile(&moniker(&req.workspace))?;
        grant_workspace(&req.workspace, sid.0)?;

        let mut capability_sid = Vec::new();
        let mut capabilities = Vec::new();
        if req.allow_network {
            capabilities.push(internet_capability(&mut capability_sid)?);
        }
        let mut security = SECURITY_CAPABILITIES {
            AppContainerSid: sid.0,
            Capabilities: if capabilities.is_empty() {
                std::ptr::null_mut()
            } else {
                capabilities.as_mut_ptr()
            },
            CapabilityCount: capabilities.len() as u32,
            Reserved: 0,
        };

        // Two calls: the first only reports the size, the second initializes the
        // buffer we just allocated for it.
        let mut size: usize = 0;
        unsafe {
            InitializeProcThreadAttributeList(std::ptr::null_mut(), 1, 0, &mut size);
        }
        let mut attribute_buffer = vec![0u8; size];
        let attributes = attribute_buffer.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
        if unsafe { InitializeProcThreadAttributeList(attributes, 1, 0, &mut size) } == 0 {
            return Err(format!(
                "could not initialize the spawn attributes: {}",
                last_error()
            ));
        }
        let applied = unsafe {
            UpdateProcThreadAttribute(
                attributes,
                0,
                PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
                &mut security as *mut _ as *const c_void,
                std::mem::size_of::<SECURITY_CAPABILITIES>(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if applied == 0 {
            let message = last_error();
            unsafe { DeleteProcThreadAttributeList(attributes) };
            return Err(format!(
                "could not attach the AppContainer token: {message}"
            ));
        }

        let (stdin, stdout, stderr) = inheritable_std_handles();
        let mut startup: STARTUPINFOEXW = unsafe { std::mem::zeroed() };
        startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = stdin;
        startup.StartupInfo.hStdOutput = stdout;
        startup.StartupInfo.hStdError = stderr;
        startup.lpAttributeList = attributes;

        let mut line = wide(OsStr::new(&command_line(&req.program, &req.args)));
        let cwd = wide(req.workspace.as_os_str());
        let mut process: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
        let spawned = unsafe {
            CreateProcessW(
                std::ptr::null(),
                line.as_mut_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
                EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
                std::ptr::null(),
                cwd.as_ptr(),
                &startup.StartupInfo,
                &mut process,
            )
        };
        unsafe { DeleteProcThreadAttributeList(attributes) };
        if spawned == 0 {
            // Easily the most likely failure: the shell lives somewhere the
            // container cannot read, such as a per-user Git install under
            // AppData, which grants nothing to application packages.
            return Err(format!(
                "could not start {} inside the sandbox: {}. A shell installed \
                 under your user profile is unreadable to the sandbox; install \
                 Git for Windows system-wide instead.",
                req.program.display(),
                last_error()
            ));
        }

        let code = wait_for(process.hProcess);
        unsafe {
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
        }
        code
    }

    fn wait_for(process: HANDLE) -> Result<i32, String> {
        if unsafe { WaitForSingleObject(process, INFINITE) } == WAIT_FAILED {
            return Err(format!(
                "could not wait for the sandboxed shell: {}",
                last_error()
            ));
        }
        let mut code: u32 = 0;
        if unsafe { GetExitCodeProcess(process, &mut code) } == 0 {
            return Err(format!(
                "could not read the shell's exit code: {}",
                last_error()
            ));
        }
        Ok(code as i32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ws() -> PathBuf {
        PathBuf::from(r"C:\Users\me\.jan\agent-workspace\threads\t1")
    }

    #[test]
    fn the_moniker_fits_what_windows_accepts() {
        let name = moniker(&ws());
        assert!(name.len() <= 64, "{name}");
        assert!(name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_'));
    }

    #[test]
    fn the_same_workspace_always_maps_to_the_same_container() {
        // The next command in a thread must reach the container the last one
        // used, or its workspace grant would not apply.
        assert_eq!(moniker(&ws()), moniker(&ws()));
        assert_eq!(
            moniker(&ws()),
            moniker(Path::new(r"C:\USERS\ME\.JAN\AGENT-WORKSPACE\THREADS\T1"))
        );
    }

    #[test]
    fn different_workspaces_map_to_different_containers() {
        // This is the whole of the cross-thread isolation: the workspace ACE
        // names one container SID, so a command for another thread holds a
        // token that ACE does not match.
        let mine = moniker(&ws());
        let theirs = moniker(Path::new(r"C:\Users\me\.jan\agent-workspace\threads\t2"));
        assert_ne!(mine, theirs);
    }

    #[test]
    fn helper_args_end_with_the_shell_so_the_command_appends_last() {
        let args = helper_args(&ws(), false, Path::new("bash.exe"), &["-c".to_string()]);
        let sep = args.iter().position(|a| a == "--").expect("separator");
        assert_eq!(
            &args[sep + 1..],
            &["bash.exe".to_string(), "-c".to_string()]
        );
        assert_eq!(args[0], SANDBOX_EXEC_FLAG);
    }

    #[test]
    fn helper_args_carry_the_network_decision() {
        let denied = helper_args(&ws(), false, Path::new("bash.exe"), &[]);
        assert!(denied.contains(&NET_OFF.to_string()));
        assert!(!denied.contains(&NET_ON.to_string()));
        let allowed = helper_args(&ws(), true, Path::new("bash.exe"), &[]);
        assert!(allowed.contains(&NET_ON.to_string()));
    }

    #[test]
    fn the_helper_round_trips_its_own_argv() {
        let args = helper_args(
            &ws(),
            true,
            Path::new(r"C:\Program Files\Git\bin\bash.exe"),
            &["-c".to_string(), "echo hi".to_string()],
        );
        let req = parse_request(args).expect("parsed");
        assert_eq!(req.workspace, ws());
        assert!(req.allow_network);
        assert_eq!(req.program, Path::new(r"C:\Program Files\Git\bin\bash.exe"));
        assert_eq!(req.args, vec!["-c".to_string(), "echo hi".to_string()]);
    }

    #[test]
    fn a_normal_launch_is_not_mistaken_for_the_helper() {
        assert!(parse_request(Vec::<String>::new()).is_none());
        assert!(parse_request(vec!["--version".to_string()]).is_none());
        // Truncated or malformed requests must not run something unconfined.
        assert!(parse_request(vec![SANDBOX_EXEC_FLAG.to_string()]).is_none());
        assert!(parse_request(vec![
            SANDBOX_EXEC_FLAG.to_string(),
            "--maybe".to_string(),
            r"C:\ws".to_string(),
            "--".to_string(),
            "bash.exe".to_string(),
        ])
        .is_none());
    }

    #[test]
    fn quoting_leaves_plain_arguments_alone() {
        assert_eq!(quote_arg("-c"), "-c");
        assert_eq!(quote_arg("bash.exe"), "bash.exe");
        assert_eq!(quote_arg(""), "\"\"");
    }

    #[test]
    fn quoting_survives_spaces_quotes_and_trailing_backslashes() {
        assert_eq!(quote_arg("echo hi"), "\"echo hi\"");
        assert_eq!(quote_arg(r#"say "hi""#), r#""say \"hi\"""#);
        // A trailing backslash must be doubled, or it would escape the closing
        // quote and swallow the next argument.
        assert_eq!(quote_arg(r"C:\dir with space\"), r#""C:\dir with space\\""#);
        assert_eq!(
            quote_arg(r"C:\Program Files\Git"),
            r#""C:\Program Files\Git""#
        );
    }

    #[test]
    fn the_command_line_keeps_the_command_a_single_argument() {
        let line = command_line(
            Path::new(r"C:\Program Files\Git\bin\bash.exe"),
            &["-c".to_string(), "ls -la && echo \"done\"".to_string()],
        );
        assert_eq!(
            line,
            r#""C:\Program Files\Git\bin\bash.exe" -c "ls -la && echo \"done\"""#
        );
    }
}
