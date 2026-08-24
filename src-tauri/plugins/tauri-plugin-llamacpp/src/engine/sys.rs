//! The FFI boundary itself. Two implementations behind one API: the real one
//! when the `engine` feature compiled llama.cpp in, and a stub that reports
//! `Unavailable` otherwise, so the rest of the crate compiles either way.

use super::EngineError;

/// Load-lifecycle notifications from the engine: `(state, payload_json)`,
/// llama.cpp's own `server_state` name and its JSON. Called on the loading
/// thread, and later on the engine's loop thread for a sleep/resume, so it
/// must be `Send + Sync`.
pub type StateCallback = std::sync::Arc<dyn Fn(&str, &str) + Send + Sync>;

#[cfg(feature = "engine")]
mod imp {
    use super::EngineError;
    use std::ffi::{c_char, c_int, c_void, CStr, CString};

    use super::StateCallback;

    type EngineHandle = *mut c_void;
    type ResponseHandle = *mut c_void;
    type StateTrampoline =
        unsafe extern "C" fn(state: *const c_char, payload: *const c_char, user_data: *mut c_void);

    // The shim's ABI. Hand-declared rather than bindgen-generated: it is our
    // own 14-function surface, so there is no upstream struct layout to track
    // and no libclang on the build path.
    extern "C" {
        fn jan_llama_engine_start(
            argv: *const *const c_char,
            argc: c_int,
            on_state: Option<StateTrampoline>,
            user_data: *mut c_void,
            err: *mut u8,
            err_len: usize,
        ) -> EngineHandle;
        fn jan_llama_engine_start_from_preset(
            ini_path: *const c_char,
            preset_name: *const c_char,
            on_state: Option<StateTrampoline>,
            user_data: *mut c_void,
            err: *mut u8,
            err_len: usize,
        ) -> EngineHandle;
        fn jan_llama_engine_stop(engine: EngineHandle);
        fn jan_llama_engine_request(
            engine: EngineHandle,
            route: *const c_char,
            query: *const c_char,
            body: *const c_char,
            body_len: usize,
        ) -> ResponseHandle;
        fn jan_llama_response_status(res: ResponseHandle) -> c_int;
        fn jan_llama_response_content_type(res: ResponseHandle) -> *const c_char;
        fn jan_llama_response_body(res: ResponseHandle, len: *mut usize) -> *const c_char;
        fn jan_llama_response_is_stream(res: ResponseHandle) -> c_int;
        fn jan_llama_response_next(
            res: ResponseHandle,
            chunk: *mut *const c_char,
            len: *mut usize,
        ) -> c_int;
        fn jan_llama_response_cancel(res: ResponseHandle);
        fn jan_llama_response_free(res: ResponseHandle);
        fn jan_llama_load_backends(dir: *const c_char);
        fn jan_llama_devices_json() -> *mut c_char;
        fn jan_llama_string_free(s: *mut c_char);
        fn jan_llama_version() -> *const c_char;
        fn jan_llama_build_number() -> c_int;
        fn jan_llama_commit() -> *const c_char;
    }

    /// SAFETY: the handle is only ever produced by the shim and only consumed
    /// by it. The C++ side funnels every request through `server_queue`, which
    /// is the same cross-thread channel llama-server's HTTP workers use, so
    /// sharing one engine across threads is the intended usage.
    pub struct Engine {
        handle: EngineHandle,
        /// Kept alive for exactly as long as the engine: the C++ side holds a
        /// `std::function` wrapping this pointer and can call it from its loop
        /// thread, so it is freed only after `jan_llama_engine_stop` has
        /// joined that thread.
        state_cb: Option<*mut StateCallback>,
    }
    unsafe impl Send for Engine {}
    unsafe impl Sync for Engine {}

    /// The C ABI entry point handed to the shim. Panics are caught rather than
    /// unwound into C++, where unwinding past a `noexcept` boundary is
    /// undefined; a poisoned callback drops its sample instead.
    unsafe extern "C" fn state_trampoline(
        state: *const c_char,
        payload: *const c_char,
        user_data: *mut c_void,
    ) {
        if user_data.is_null() {
            return;
        }
        let _ = std::panic::catch_unwind(|| {
            let cb = unsafe { &*(user_data as *const StateCallback) };
            let state = unsafe { CStr::from_ptr(state) }.to_string_lossy();
            let payload = if payload.is_null() {
                std::borrow::Cow::Borrowed("{}")
            } else {
                unsafe { CStr::from_ptr(payload) }.to_string_lossy()
            };
            cb(&state, &payload);
        });
    }

    /// Leaks the callback for the duration of the call; `from_handle` either
    /// hands ownership to the `Engine` or frees it.
    fn leak_state_cb(cb: Option<StateCallback>) -> Option<*mut StateCallback> {
        cb.map(|c| Box::into_raw(Box::new(c)))
    }

    impl std::fmt::Debug for Engine {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            // The handle is an opaque C++ pointer; printing it is noise.
            f.write_str("Engine(<llama.cpp server_context>)")
        }
    }

    /// Room for the shim's summary plus the llama.cpp error lines it captured
    /// during the load; a load failure carries several and 1 KiB truncated
    /// them mid-cause.
    const ERR_BUF_LEN: usize = 4096;

    impl Engine {
        /// Starts from llama-server's own flag set, so callers reuse the
        /// upstream arg table instead of mirroring `common_params`.
        pub fn start(args: &[String], on_state: Option<StateCallback>) -> Result<Self, EngineError> {
            let owned: Vec<CString> = args
                .iter()
                .map(|a| CString::new(a.as_str()).unwrap_or_default())
                .collect();
            let argv: Vec<*const c_char> = owned.iter().map(|c| c.as_ptr()).collect();
            let mut err = vec![0u8; ERR_BUF_LEN];
            let state_cb = leak_state_cb(on_state);
            // SAFETY: argv points at `owned`, alive for the call; the shim
            // copies every string and retains none of these pointers.
            let handle = unsafe {
                jan_llama_engine_start(
                    argv.as_ptr(),
                    argv.len() as c_int,
                    state_cb.map(|_| state_trampoline as StateTrampoline),
                    state_cb.map_or(std::ptr::null_mut(), |p| p as *mut c_void),
                    err.as_mut_ptr(),
                    err.len(),
                )
            };
            Self::from_handle(handle, state_cb, &err)
        }

        /// Starts from a `router.preset.ini` section, the file Jan already
        /// generates. `[*]` is applied first, then the named section.
        pub fn start_from_preset(
            ini_path: &str,
            preset: &str,
            on_state: Option<StateCallback>,
        ) -> Result<Self, EngineError> {
            let ini = CString::new(ini_path).map_err(|e| EngineError::Start(e.to_string()))?;
            let name = CString::new(preset).map_err(|e| EngineError::Start(e.to_string()))?;
            let mut err = vec![0u8; ERR_BUF_LEN];
            let state_cb = leak_state_cb(on_state);
            // SAFETY: both pointers are valid for the duration of the call.
            let handle = unsafe {
                jan_llama_engine_start_from_preset(
                    ini.as_ptr(),
                    name.as_ptr(),
                    state_cb.map(|_| state_trampoline as StateTrampoline),
                    state_cb.map_or(std::ptr::null_mut(), |p| p as *mut c_void),
                    err.as_mut_ptr(),
                    err.len(),
                )
            };
            Self::from_handle(handle, state_cb, &err)
        }

        fn from_handle(
            handle: EngineHandle,
            state_cb: Option<*mut StateCallback>,
            err: &[u8],
        ) -> Result<Self, EngineError> {
            if handle.is_null() {
                // Nothing on the C++ side survived to call it.
                if let Some(p) = state_cb {
                    // SAFETY: leaked by this call and reachable from nowhere else.
                    unsafe { drop(Box::from_raw(p)) };
                }
                let msg = CStr::from_bytes_until_nul(err)
                    .map(|c| c.to_string_lossy().into_owned())
                    .unwrap_or_else(|_| "unknown error".to_string());
                return Err(EngineError::Start(msg));
            }
            Ok(Self { handle, state_cb })
        }

        pub fn request(&self, route: &str, body: &str) -> Response {
            self.request_with_query(route, "", body)
        }

        /// `query` is a url query string. llama.cpp takes a slot action
        /// (`id_slot=0&action=save`) from there rather than from the body, so
        /// the slot routes are unreachable through `request` alone.
        pub fn request_with_query(&self, route: &str, query: &str, body: &str) -> Response {
            let r = CString::new(route).unwrap_or_default();
            let q = CString::new(query).unwrap_or_default();
            let b = CString::new(body).unwrap_or_default();
            // SAFETY: the shim never returns null -- transport failures come
            // back as a 5xx response object -- and copies the body.
            let handle = unsafe {
                jan_llama_engine_request(self.handle, r.as_ptr(), q.as_ptr(), b.as_ptr(), body.len())
            };
            Response(handle)
        }

        /// Registers the ggml compute backends. `None` uses ggml's own search
        /// (executable directory, then cwd).
        pub fn load_backends(dir: Option<&str>) {
            match dir {
                Some(d) => {
                    let c = CString::new(d).unwrap_or_default();
                    // SAFETY: the shim copies nothing and only reads the
                    // string for the duration of the call.
                    unsafe { jan_llama_load_backends(c.as_ptr()) }
                }
                // SAFETY: null is the documented "use ggml's own search" value.
                None => unsafe { jan_llama_load_backends(std::ptr::null()) },
            }
        }

        /// The offloadable devices, as the shim's JSON array. Needs no engine:
        /// ggml devices are process-global, so this is an associated function.
        pub fn devices_json() -> Result<String, EngineError> {
            // SAFETY: the shim malloc()s the string and we hand the same
            // pointer back to its free; a null return is only OOM.
            let raw = unsafe { jan_llama_devices_json() };
            if raw.is_null() {
                return Err(EngineError::Unavailable);
            }
            let json = unsafe { CStr::from_ptr(raw) }.to_string_lossy().into_owned();
            unsafe { jan_llama_string_free(raw) };
            Ok(json)
        }

        pub fn linked_version() -> Result<String, EngineError> {
            // SAFETY: returns a pointer to a static string in the shim.
            Ok(unsafe { CStr::from_ptr(jan_llama_version()) }
                .to_string_lossy()
                .into_owned())
        }

        pub fn linked_build_number() -> Result<i32, EngineError> {
            // SAFETY: a plain int getter with no arguments.
            Ok(unsafe { jan_llama_build_number() })
        }

        pub fn linked_commit() -> Result<String, EngineError> {
            // SAFETY: returns a pointer to a static string in the shim.
            Ok(unsafe { CStr::from_ptr(jan_llama_commit()) }
                .to_string_lossy()
                .into_owned())
        }
    }

    impl Drop for Engine {
        fn drop(&mut self) {
            // SAFETY: called once, from Drop, on a handle we own. `stop` joins
            // the loop thread, so no callback can be in flight afterwards --
            // which is what makes freeing the boxed closure next safe.
            unsafe { jan_llama_engine_stop(self.handle) }
            if let Some(p) = self.state_cb.take() {
                // SAFETY: leaked by `start`/`start_from_preset` for this engine.
                unsafe { drop(Box::from_raw(p)) };
            }
        }
    }

    /// One in-flight response. Either a whole body or a chunk generator; the
    /// request it was made from is owned on the C++ side and outlives it.
    pub struct Response(ResponseHandle);
    unsafe impl Send for Response {}

    impl std::fmt::Debug for Response {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.debug_struct("Response")
                .field("status", &self.status())
                .field("is_stream", &self.is_stream())
                .finish()
        }
    }

    impl Response {
        pub fn status(&self) -> u16 {
            // SAFETY: handle is valid for our lifetime.
            (unsafe { jan_llama_response_status(self.0) }).clamp(0, u16::MAX as i32) as u16
        }

        pub fn content_type(&self) -> String {
            // SAFETY: points into the response's own std::string.
            unsafe { CStr::from_ptr(jan_llama_response_content_type(self.0)) }
                .to_string_lossy()
                .into_owned()
        }

        pub fn body(&self) -> String {
            let mut len = 0usize;
            // SAFETY: the shim returns a pointer plus length into a buffer that
            // lives as long as this response.
            unsafe {
                let p = jan_llama_response_body(self.0, &mut len);
                String::from_utf8_lossy(std::slice::from_raw_parts(p.cast::<u8>(), len))
                    .into_owned()
            }
        }

        pub fn is_stream(&self) -> bool {
            // SAFETY: handle is valid for our lifetime.
            (unsafe { jan_llama_response_is_stream(self.0) }) != 0
        }

        /// `Ok(Some(chunk))` for a chunk (possibly empty, meaning "nothing
        /// yet"), `Ok(None)` when the stream is finished, `Err` if the
        /// generator threw.
        pub fn next_chunk(&mut self) -> Result<Option<String>, EngineError> {
            let mut p: *const c_char = std::ptr::null();
            let mut len = 0usize;
            // SAFETY: out-params are stack locals; the returned buffer is owned
            // by the response and valid until the next call on it.
            let rc = unsafe { jan_llama_response_next(self.0, &mut p, &mut len) };
            match rc {
                1 => {
                    // SAFETY: rc == 1 means p/len describe a live buffer.
                    let s = unsafe {
                        String::from_utf8_lossy(std::slice::from_raw_parts(p.cast::<u8>(), len))
                            .into_owned()
                    };
                    Ok(Some(s))
                }
                0 => Ok(None),
                _ => Err(EngineError::Start(
                    "the response generator threw".to_string(),
                )),
            }
        }

        /// Asks the generator to stop. Safe to call from another thread, which
        /// is how a dropped HTTP connection cancels generation.
        pub fn cancel(&self) {
            // SAFETY: the shim's cancel flag is an atomic bool.
            unsafe { jan_llama_response_cancel(self.0) }
        }
    }

    impl Drop for Response {
        fn drop(&mut self) {
            // SAFETY: called once, from Drop, on a handle we own.
            unsafe { jan_llama_response_free(self.0) }
        }
    }
}

#[cfg(not(feature = "engine"))]
mod imp {
    use super::EngineError;

    /// Placeholder so the crate compiles without a C++ toolchain. Every entry
    /// point reports `Unavailable` rather than panicking, so a build without
    /// the feature degrades to "no local inference" instead of crashing.
    #[derive(Debug)]
    pub struct Engine(());

    impl Engine {
        pub fn start(
            _args: &[String],
            _on_state: Option<super::StateCallback>,
        ) -> Result<Self, EngineError> {
            Err(EngineError::Unavailable)
        }
        pub fn start_from_preset(
            _ini: &str,
            _preset: &str,
            _on_state: Option<super::StateCallback>,
        ) -> Result<Self, EngineError> {
            Err(EngineError::Unavailable)
        }
        /// A resident model that never serves a request, so the registry's
        /// bookkeeping -- eviction order, and which ids a drop path records --
        /// can be tested in the default feature config, where `start` always
        /// fails and nothing can otherwise reach `loaded`.
        #[cfg(test)]
        pub fn stub() -> Self {
            Engine(())
        }
        pub fn request(&self, _route: &str, _body: &str) -> Response {
            Response(())
        }
        pub fn request_with_query(&self, _route: &str, _query: &str, _body: &str) -> Response {
            Response(())
        }
        pub fn load_backends(_dir: Option<&str>) {}
        pub fn devices_json() -> Result<String, EngineError> {
            Err(EngineError::Unavailable)
        }
        pub fn linked_version() -> Result<String, EngineError> {
            Err(EngineError::Unavailable)
        }
        pub fn linked_build_number() -> Result<i32, EngineError> {
            Err(EngineError::Unavailable)
        }
        pub fn linked_commit() -> Result<String, EngineError> {
            Err(EngineError::Unavailable)
        }
    }

    #[derive(Debug)]
    pub struct Response(());

    impl Response {
        pub fn status(&self) -> u16 {
            503
        }
        pub fn content_type(&self) -> String {
            "application/json; charset=utf-8".to_string()
        }
        pub fn body(&self) -> String {
            r#"{"error":{"message":"the llama.cpp engine was not compiled in"}}"#.to_string()
        }
        pub fn is_stream(&self) -> bool {
            false
        }
        pub fn next_chunk(&mut self) -> Result<Option<String>, EngineError> {
            Ok(None)
        }
        pub fn cancel(&self) {}
    }
}

pub use imp::{Engine, Response};
