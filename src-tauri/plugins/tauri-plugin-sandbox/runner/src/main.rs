/// Tiny JavaScript runner compiled to wasm32-wasip1.
///
/// Usage (WASI argv):  js-runner <js-source-code>
///
/// stdout  → captured by the host as "stdout"
/// stderr  → captured by the host as "stderr"
/// exit 0  → success, exit 1 → JS error
///
/// Host functions exposed to JS:
///   console.log(...)  → println!  → host stdout
///   console.error(..) → eprintln! → host stderr
///   console.warn(..)  → eprintln! → host stderr
///   Date.now()        → ms since Unix epoch
///   performance.now() → ms since Unix epoch (high-res f64)
///   formatDate(ms?)   → ISO 8601 UTC string (defaults to now)
///   httpGet(url)      → HTTP GET, returns body as string
///   fetch(url)        → HTTP GET, returns { ok, status, text(), json() }
///
/// Security: No filesystem, environment, or home directory access.

use boa_engine::{
    js_string,
    native_function::NativeFunction,
    object::ObjectInitializer,
    property::Attribute,
    Context, JsError, JsNativeError, JsValue, Source,
};

// ── Host imports (provided by wasm_runtime.rs linker) ──────────────────────

#[link(wasm_import_module = "host")]
extern "C" {
    fn http_get(url_ptr: i32, url_len: i32, buf_ptr: i32, buf_max: i32) -> i32;
}

static mut HTTP_BUF: [u8; 256 * 1024] = [0u8; 256 * 1024]; // 256 KB

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let code = match args.get(1) {
        Some(s) => s.as_str(),
        None => {
            eprintln!("usage: js-runner <code>");
            std::process::exit(1);
        }
    };

    let mut ctx = Context::default();

    if let Err(e) = register_console(&mut ctx) {
        eprintln!("console setup: {e}");
        std::process::exit(1);
    }
    if let Err(e) = register_timing(&mut ctx) {
        eprintln!("timing setup: {e}");
        std::process::exit(1);
    }
    if let Err(e) = register_host_fns(&mut ctx) {
        eprintln!("host fn setup: {e}");
        std::process::exit(1);
    }

    match ctx.eval(Source::from_bytes(code.as_bytes())) {
        Ok(_) => {}
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}

// ── console object ─────────────────────────────────────────────────────────

fn register_console(ctx: &mut Context) -> Result<(), String> {
    let log_fn = NativeFunction::from_fn_ptr(|_this, args, ctx| {
        println!("{}", args_to_string(args, ctx));
        Ok(JsValue::undefined())
    });
    let err_fn = NativeFunction::from_fn_ptr(|_this, args, ctx| {
        eprintln!("{}", args_to_string(args, ctx));
        Ok(JsValue::undefined())
    });
    let warn_fn = NativeFunction::from_fn_ptr(|_this, args, ctx| {
        eprintln!("{}", args_to_string(args, ctx));
        Ok(JsValue::undefined())
    });

    let console = ObjectInitializer::new(ctx)
        .function(log_fn,  js_string!("log"),   0)
        .function(err_fn,  js_string!("error"), 0)
        .function(warn_fn, js_string!("warn"),  0)
        .build();

    ctx.register_global_property(js_string!("console"), console, Attribute::all())
        .map_err(|e| format!("console: {e}"))
}

// ── timing (Date.now / performance.now / formatDate) ────────────────────────

fn register_timing(ctx: &mut Context) -> Result<(), String> {
    let perf_now = NativeFunction::from_fn_ptr(|_this, _args, _ctx| {
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0);
        Ok(JsValue::from(ms))
    });
    let performance = ObjectInitializer::new(ctx)
        .function(perf_now, js_string!("now"), 0)
        .build();
    ctx.register_global_property(js_string!("performance"), performance, Attribute::all())
        .map_err(|e| format!("performance: {e}"))?;

    let date_now = NativeFunction::from_fn_ptr(|_this, _args, _ctx| {
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0);
        Ok(JsValue::from(ms))
    });
    let date = ObjectInitializer::new(ctx)
        .function(date_now, js_string!("now"), 0)
        .build();
    ctx.register_global_property(js_string!("Date"), date, Attribute::all())
        .map_err(|e| format!("Date: {e}"))?;

    // formatDate(ms?) → "2026-03-21T17:30:45Z"
    // If no argument, uses current time.
    let format_date = NativeFunction::from_fn_ptr(|_this, args, _ctx| {
        let epoch_ms = if let Some(n) = args.first().and_then(|v| v.as_number()) {
            n as u64
        } else {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0)
        };

        let secs = (epoch_ms / 1000) as i64;
        // Manual UTC breakdown (no chrono dependency)
        let days_since_epoch = secs / 86400;
        let time_of_day = secs % 86400;
        let hour = time_of_day / 3600;
        let minute = (time_of_day % 3600) / 60;
        let second = time_of_day % 60;

        // Civil date from days since 1970-01-01 (Algorithm from Howard Hinnant)
        let z = days_since_epoch + 719468;
        let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
        let doe = z - era * 146097;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        let y = yoe + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = if m <= 2 { y + 1 } else { y };

        let formatted = format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
            y, m, d, hour, minute, second
        );
        Ok(JsValue::from(boa_engine::JsString::from(formatted.as_str())))
    });
    ctx.register_global_callable(js_string!("formatDate"), 0, format_date)
        .map_err(|e| format!("formatDate: {e}"))?;

    Ok(())
}

// ── host functions ──────────────────────────────────────────────────────────

fn register_host_fns(ctx: &mut Context) -> Result<(), String> {
    // httpGet(url) → string (response body) — simple API
    let http_get_fn = NativeFunction::from_fn_ptr(|_this, args, ctx| {
        let url = require_str_arg(args, 0, "httpGet", ctx)?;
        let url_bytes = url.as_bytes();
        let n = unsafe {
            http_get(
                url_bytes.as_ptr() as i32,
                url_bytes.len() as i32,
                HTTP_BUF.as_mut_ptr() as i32,
                HTTP_BUF.len() as i32,
            )
        };
        if n < 0 {
            return Err(js_err(format!("httpGet '{url}': request failed")));
        }
        let body = unsafe { std::str::from_utf8(&HTTP_BUF[..n as usize]).unwrap_or("") };
        Ok(JsValue::from(boa_engine::JsString::from(body)))
    });

    ctx.register_global_callable(js_string!("httpGet"), 1, http_get_fn)
        .map_err(|e| format!("httpGet: {e}"))?;

    // fetch(url) → Response-like object { ok, status, text(), json() }
    //
    // Models trained on web/Node.js code naturally reach for fetch().
    // This synchronous shim wraps httpGet so `fetch(url).json()` and
    // `fetch(url).text()` work without async/await.
    // `await fetch(url)` also works — awaiting a non-Promise is a no-op.
    ctx.eval(Source::from_bytes(
        br#"function fetch(url) {
    var _body = httpGet(url);
    return {
        ok: true,
        status: 200,
        text: function() { return _body; },
        json: function() { return JSON.parse(_body); }
    };
}"#,
    ))
    .map_err(|e| format!("fetch shim: {e}"))?;

    Ok(())
}

// ── helpers ─────────────────────────────────────────────────────────────────

fn js_err(msg: impl Into<String>) -> JsError {
    JsNativeError::error().with_message(msg.into()).into()
}

fn require_str_arg(
    args: &[JsValue],
    idx: usize,
    fn_name: &str,
    ctx: &mut Context,
) -> Result<String, JsError> {
    let val = args.get(idx).ok_or_else(|| {
        JsError::from(JsNativeError::typ().with_message(format!("{fn_name}: argument {idx} required")))
    })?;
    val.to_string(ctx)
        .map(|s| s.to_std_string_escaped())
        .map_err(|e| JsError::from(JsNativeError::typ().with_message(format!("{fn_name}: {e}"))))
}

fn args_to_string(args: &[JsValue], ctx: &mut Context) -> String {
    args.iter()
        .map(|v| {
            if v.is_undefined()              { return "undefined".into(); }
            if v.is_null()                   { return "null".into(); }
            if let Some(b) = v.as_boolean()  { return b.to_string(); }
            if let Some(n) = v.as_number()   { return n.to_string(); }
            if let Some(s) = v.as_string()   { return s.to_std_string_escaped(); }
            v.to_string(ctx)
                .map(|s| s.to_std_string_escaped())
                .unwrap_or_else(|_| "[object]".into())
        })
        .collect::<Vec<_>>()
        .join(" ")
}
