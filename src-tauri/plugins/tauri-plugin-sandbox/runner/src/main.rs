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
///   readFile(path)    → std::fs::read_to_string  (WASI-governed)
///   listDir(path)     → std::fs::read_dir        (WASI-governed)
///   getenv(name)      → std::env::var
///   homeDir()         → $HOME / $USERPROFILE / "/"

use boa_engine::{
    js_string,
    native_function::NativeFunction,
    object::ObjectInitializer,
    property::Attribute,
    Context, JsError, JsNativeError, JsValue, Source,
};

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

// ── host functions ──────────────────────────────────────────────────────────

fn register_host_fns(ctx: &mut Context) -> Result<(), String> {
    // readFile(path) → string
    let read_file = NativeFunction::from_fn_ptr(|_this, args, ctx| {
        let path = require_str_arg(args, 0, "readFile", ctx)?;
        std::fs::read_to_string(&path)
            .map(|s| JsValue::from(boa_engine::JsString::from(s.as_str())))
            .map_err(|e| js_err(format!("readFile '{path}': {e}")))
    });

    // listDir(path) → string (newline-separated, sorted)
    let list_dir = NativeFunction::from_fn_ptr(|_this, args, ctx| {
        let path = require_str_arg(args, 0, "listDir", ctx)?;
        let mut names: Vec<String> = std::fs::read_dir(&path)
            .map_err(|e| js_err(format!("listDir '{path}': {e}")))?
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        Ok(JsValue::from(boa_engine::JsString::from(names.join("\n").as_str())))
    });

    // getenv(name) → string | undefined
    let getenv = NativeFunction::from_fn_ptr(|_this, args, ctx| {
        let name = require_str_arg(args, 0, "getenv", ctx)?;
        match std::env::var(&name) {
            Ok(val) => Ok(JsValue::from(boa_engine::JsString::from(val.as_str()))),
            Err(_)  => Ok(JsValue::undefined()),
        }
    });

    // homeDir() → string
    let home_dir = NativeFunction::from_fn_ptr(|_this, _args, _ctx| {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| "/".into());
        Ok(JsValue::from(boa_engine::JsString::from(home.as_str())))
    });

    ctx.register_global_callable(js_string!("readFile"), 1, read_file)
        .map_err(|e| format!("readFile: {e}"))?;
    ctx.register_global_callable(js_string!("listDir"), 1, list_dir)
        .map_err(|e| format!("listDir: {e}"))?;
    ctx.register_global_callable(js_string!("getenv"), 1, getenv)
        .map_err(|e| format!("getenv: {e}"))?;
    ctx.register_global_callable(js_string!("homeDir"), 0, home_dir)
        .map_err(|e| format!("homeDir: {e}"))?;

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
