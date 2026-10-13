//! Shell-command decomposition for the exec permission gate. Reduces a command
//! to the set of base commands it will actually run, so a session grant cannot
//! be escalated by hiding a second command behind `&&`, a pipe, a wrapper like
//! `sudo`, or a `$(...)` substitution. `git status && rm -rf ~` yields
//! `{git, rm}`, not `{git}`.
//!
//! Commands whose real behavior cannot be reasoned about statically (`eval`,
//! `xargs`, `find -exec`, `sudo`, ...) are reported as [`CommandScan::Opaque`]
//! so the gate always prompts for them. The scan fails safe: any construct it
//! cannot resolve degrades toward prompting, never toward silent allow.
//!
//! A grant on a base only means something while that name still resolves to
//! the program the user approved. So a segment yields bases only when it is a
//! plain invocation: a literal command word with arguments that the shell
//! expands but never evaluates as code. Anything that can change what a name
//! resolves to (aliases, functions, `hash`, `PATH`, modules), or that
//! evaluates text from a variable (bash arithmetic, PowerShell member calls),
//! makes the command opaque. A path stays part of its base: `./ls` is not
//! `ls`, and a grant on one does not cover the other.

use std::collections::BTreeSet;

use crate::tools::proc::{self, ShellKind};

#[derive(Debug, PartialEq, Eq)]
pub enum CommandScan {
    /// The full set of base commands this command will execute.
    Bases(BTreeSet<String>),
    /// The command runs code that can't be statically resolved to a base set
    /// (e.g. `eval`, `sudo`, `find -exec`); it must always prompt.
    Opaque,
}

/// Commands whose argument *is* code to run, or that escalate privilege /
/// reach off-box. We cannot bound what they execute, so they are always opaque.
/// `alias` and `shopt` belong here too: with `shopt -s expand_aliases`, an
/// `alias ls='rm -rf ~'` makes a later, already granted `ls` run its value.
const OPAQUE: &[&str] = &[
    "eval", "xargs", "source", ".", "sudo", "su", "doas", "ssh", "watch", "alias", "shopt",
    // Defining a function renames a later base; PowerShell's `filter` too.
    "function", "filter",
    // The bash builtins (a closed set) that redefine a name or run text as
    // code: `hash -p /bin/rm ls` and `enable -f x.so ls` repoint `ls`; `trap`,
    // `bind -x`, `complete -C`, `compgen -C` and `fc` run their argument;
    // `declare`/`typeset`/`local`/`readonly`/`let`/`getopts`/`mapfile`
    // assign through names whose `a[...]` subscript bash evaluates, running
    // any `$(...)` in it.
    "hash", "enable", "trap", "bind", "complete", "compgen", "compopt", "fc", "declare",
    "typeset", "local", "readonly", "let", "getopts", "mapfile", "readarray",
];
/// Builtins that assign to the variable names in their arguments. Plain when
/// every name is an ordinary one: not one of [`RESOLUTION_VARS`] and with no
/// `[...]` subscript, which bash evaluates as arithmetic.
const ASSIGNING_BUILTINS: &[&str] = &["export", "unset", "read", "set", "setx"];
/// Shell and loader variables that decide which program a name runs, or that
/// run code on their own (`BASH_ENV`, `PS4` under `set -x`). Assigning one
/// changes what an already granted base means. Matched case-insensitively.
const RESOLUTION_VARS: &[&str] = &[
    "path", "pathext", "comspec", "psmodulepath", "bash_env", "env", "bashopts",
    "shellopts", "ps4", "prompt_command", "ifs", "execignore", "bash_loadables_path",
];
/// Prefixes of [`RESOLUTION_VARS`]: the dynamic loaders' preload and search
/// variables, and bash's exported functions.
const RESOLUTION_VAR_PREFIXES: &[&str] = &["ld_", "dyld_", "bash_func_"];
/// PowerShell variables that change what a later command does:
/// `$PSDefaultParameterValues` adds parameters to every call of a cmdlet.
const PS_RESOLUTION_VARS: &[&str] = &["psdefaultparametervalues", "psmoduleautoloadingpreference"];
/// `[[ ]]` operators that evaluate an operand as arithmetic (or, for `-v`, a
/// subscript), which runs any `$(...)` in a variable's value.
const ARITHMETIC_TESTS: &[&str] = &["-eq", "-ne", "-lt", "-le", "-gt", "-ge", "-v"];
/// Windows shells, PowerShell's run-this-text commands, and the cmdlets (with
/// their aliases) that run a `{ ... }` script block. Their argument is code in
/// a language this scanner does not parse, so a grant on one of them must
/// never cover what they run: approving `ls | ForEach-Object { $_.Name }`
/// must not also approve `ls | ForEach-Object { Remove-Item $_ }`. Matched
/// case-insensitively and without `.exe`, as Windows and PowerShell both
/// resolve them.
const WINDOWS_OPAQUE: &[&str] = &[
    "cmd", "powershell", "pwsh", "invoke-expression", "iex", "invoke-command", "icm",
    "start-process", "saps", "start", "invoke-item", "ii", "invoke-wmimethod", "iwmi",
    "invoke-cimmethod", "icim", "foreach-object", "foreach", "%", "where-object",
    "where", "?", "start-job", "sajb", "start-threadjob", "invoke-commandinjob",
    // Hosts that run a program, script or command line named in their
    // arguments, or schedule one to run.
    "wsl", "conhost", "cscript", "wscript", "mshta", "rundll32", "forfiles", "wmic",
    "schtasks", "at", "runas", "regsvr32", "msiexec", "explorer", "pcalua", "cmstp",
    "msbuild", "installutil", "regasm", "regsvcs", "certutil", "bitsadmin",
    "scriptrunner", "sc",
    // Aliases and functions take effect within the same script, so defining one
    // changes what a later, already granted base runs (`Set-Alias ls rm; ls`).
    "set-alias", "sal", "new-alias", "nal", "import-alias", "ipal",
    // A new drive can mount the Function or Alias provider under any name
    // (`New-PSDrive F -PSProvider Function`), out of reach of the
    // `function:`/`alias:` check.
    "new-psdrive", "ndr",
    // The item and content cmdlets write to any provider, including Function
    // and Alias, and their path can be assembled at run time
    // (`Set-Item "${a}:ls"`), which no text check can see through. Their
    // `cp`/`mv`/... aliases are handled by `POWERSHELL_ONLY_OPAQUE`, since
    // those names are ordinary file commands outside PowerShell.
    "set-item", "si", "new-item", "ni", "copy-item", "cpi", "rename-item", "rni",
    "move-item", "mi", "set-content", "add-content", "ac", "clear-content", "clc",
    // A module's exported functions join the session and take precedence over
    // a program of the same name, so importing one can redefine a granted base.
    "import-module", "ipmo",
    // A variable can be named at run time (`Set-Variable -Name $n`), and a
    // compiled type or a ScriptProperty runs code on a later member access.
    "set-variable", "sv", "new-variable", "nv", "add-type", "update-typedata",
    // cmd's `path` sets `PATH`.
    "path",
];
/// Names that are ordinary commands under bash or cmd but PowerShell aliases
/// of opaque cmdlets: `cp`/`copy`/`mv`/`move`/`ren` are the item cmdlets,
/// whose path can be built at run time (`cp x "${a}:ls"`), and `set` is
/// `Set-Variable`.
const POWERSHELL_ONLY_OPAQUE: &[&str] = &["cp", "copy", "mv", "move", "ren", "set"];

/// Whether assigning `name` (a variable name, optionally `+=`-suffixed or
/// with an `env:` drive) can change what a granted base runs. `^` is cmd's
/// escape character and is stripped from every token before cmd acts on it,
/// so `PA^TH` sets `PATH`; matching on the literal text would miss that.
fn is_resolution_var(name: &str) -> bool {
    let unescaped: String = name.chars().filter(|&c| c != '^').collect();
    let lower = unescaped.to_ascii_lowercase();
    let lower = lower.trim_end_matches('+');
    let lower = lower.strip_prefix("env:").unwrap_or(lower);
    RESOLUTION_VARS.contains(&lower) || RESOLUTION_VAR_PREFIXES.iter().any(|p| lower.starts_with(p))
}

/// Whether a `NAME=value` token assigns one of [`RESOLUTION_VARS`].
fn assigns_resolution_var(token: &str) -> bool {
    token.split_once('=').is_some_and(|(name, _)| is_resolution_var(name))
}

/// Whether a PowerShell assignment target (`$env:PATH`, `${global:x}`,
/// `[string]$env:Path`) is a variable that changes what a later command runs.
fn ps_target_is_resolution(token: &str) -> bool {
    let token = match token.strip_prefix('[') {
        Some(cast) => cast.split_once(']').map_or("", |(_, rest)| rest),
        None => token,
    };
    let target = token.trim_start_matches('$').trim_start_matches('{').to_ascii_lowercase();
    let name: String = target
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == ':')
        .collect();
    let name = ["global:", "script:", "local:", "private:"]
        .iter()
        .find_map(|scope| name.strip_prefix(scope))
        .unwrap_or(&name);
    match name.strip_prefix("env:") {
        Some(var) => is_resolution_var(var),
        None => PS_RESOLUTION_VARS.contains(&name),
    }
}

/// Whether an [`ASSIGNING_BUILTINS`] call assigns anything but an ordinary
/// variable: one of [`RESOLUTION_VARS`] (`export PATH=...`, cmd's
/// `set PATH=...`), or a subscripted name (`read 'a[$(rm x)]'`).
fn assigns_unsafely(args: &[String]) -> bool {
    args.iter().any(|t| {
        let name = t.split_once('=').map_or(t.as_str(), |(name, _)| name);
        name.contains('[') || is_resolution_var(name)
    })
}

/// Whether `s` holds a bash arithmetic evaluation that can read a variable:
/// `$((x))` or a bare `(( x ))`. Bash evaluates a variable's value as an
/// expression there, and an `a[$(rm x)]` in that value runs its command, so
/// a value read from a file can run code behind granted bases. A `$((...))`
/// of digits and operators only is plain. Expansions run inside double
/// quotes too, so only single-quoted text is skipped, and a `'` inside double
/// quotes is literal. Under bash or cmd (`params`), parameter expansions that
/// evaluate code count too ([`param_evaluates_code`]); PowerShell's
/// `${...}` is only a variable name (`${env:Path}`).
fn has_arithmetic(s: &str, params: bool) -> bool {
    let chars: Vec<char> = s.chars().collect();
    let mut in_single = false;
    let mut in_double = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if in_single {
            in_single = c != '\'';
            i += 1;
            continue;
        }
        match c {
            '\\' => i += 1,
            '\'' if !in_double => in_single = true,
            '"' => in_double = !in_double,
            '$' if params
                && chars.get(i + 1) == Some(&'{')
                && param_evaluates_code(&chars[i + 2..]) =>
            {
                return true;
            }
            // Bash's legacy `$[expr]` arithmetic.
            '$' if chars.get(i + 1) == Some(&'[') => return true,
            '(' if chars.get(i + 1) == Some(&'(') => {
                if i == 0 || chars[i - 1] != '$' {
                    // `((` inside double quotes is text, not a command.
                    if in_double {
                        i += 1;
                        continue;
                    }
                    return true;
                }
                let end = skip_balanced(&chars, i + 1).min(chars.len());
                let literal = |ch: &char| ch.is_ascii_digit() || " +-*/%()".contains(*ch);
                if !chars[i + 2..end].iter().all(literal) {
                    return true;
                }
                i = end;
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    false
}

/// Whether the parameter expansion whose body starts at `body` (just past
/// `${`) can evaluate a variable's value as code. Only known-plain forms
/// pass: a name (or `#name` for its length) with an optional literal
/// subscript (`${a[0]}`, `${a[@]}`), then `}`, a literal substring offset
/// (`${x:1}`, `${x: -2:1}`), a default operator (`:-`, `-`, `:=`, ...) or a
/// pattern operator (`#`, `%`, `/`, `^`, `,`). Everything else is code:
/// subscripts and offsets that read a variable are arithmetic (`${a[$i]}`,
/// `${x:$n}`), `${!x}` resolves a name held in `x` (an `a[$(...)]` there
/// runs), and `${x@P}` runs the `$(...)` in `x`'s value.
fn param_evaluates_code(body: &[char]) -> bool {
    let mut j = 0;
    if body.first() == Some(&'#') && body.get(1).is_some_and(|c| *c != '}') {
        j += 1;
    }
    let name_start = j;
    while body.get(j).is_some_and(|c| c.is_ascii_alphanumeric() || *c == '_') {
        j += 1;
    }
    // A special parameter (`${#}`, `${?}`, `${@}`), never `!`.
    if j == name_start {
        if !matches!(body.get(j), Some('@' | '*' | '#' | '?' | '$' | '-')) {
            return true;
        }
        j += 1;
    }
    if body.get(j) == Some(&'[') {
        let Some(len) = body[j + 1..].iter().position(|&c| c == ']') else {
            return true;
        };
        let sub = &body[j + 1..j + 1 + len];
        let literal = sub.iter().all(|c| c.is_ascii_digit())
            || sub == ['@']
            || sub == ['*'];
        if !literal || sub.is_empty() {
            return true;
        }
        j += len + 2;
    }
    match body.get(j) {
        Some('}' | '-' | '=' | '+' | '?' | '#' | '%' | '/' | '^' | ',') => false,
        Some(':') if matches!(body.get(j + 1), Some('-' | '=' | '+' | '?')) => false,
        Some(':') => {
            let end = body[j..].iter().position(|&c| c == '}').map_or(body.len(), |e| j + e);
            !body[j + 1..end]
                .iter()
                .all(|c| c.is_ascii_digit() || matches!(c, ' ' | '-' | ':'))
        }
        _ => true,
    }
}

/// Whether `s` holds a bash compound array assignment, `a=(...)` or
/// `a+=(...)`, outside single quotes. Bash evaluates each `[key]=` subscript
/// in it as arithmetic (`a=([$i]=x)`), and segment splitting cuts it apart at
/// the parens, so the whole form prompts. Applied under every shell: the
/// form is rare outside bash, and a quote-tracking slip is then never a gap.
fn has_compound_assignment(s: &str) -> bool {
    let chars: Vec<char> = s.chars().collect();
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;
    for (i, &c) in chars.iter().enumerate() {
        if in_single {
            in_single = c != '\'';
            continue;
        }
        if escaped {
            escaped = false;
            continue;
        }
        match c {
            '\\' => escaped = true,
            // A `'` inside double quotes is a literal, not a string opener.
            '\'' if !in_double => in_single = true,
            '"' => in_double = !in_double,
            '=' if chars.get(i + 1) == Some(&'(') => {
                let before = if i > 0 && chars[i - 1] == '+' { i - 1 } else { i };
                let name_end = before.checked_sub(1).map(|p| chars[p]);
                if name_end.is_some_and(|p| p.is_ascii_alphanumeric() || p == '_' || p == ']') {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

/// Whether `s` holds a bash function definition header, `name()` or
/// `name ( )`, outside quotes. Its body may be a subshell or a compound
/// command rather than a brace group, which [`has_block`] would catch.
fn has_empty_parens(s: &str) -> bool {
    let chars: Vec<char> = s.chars().collect();
    let mut quote: Option<char> = None;
    for (i, &c) in chars.iter().enumerate() {
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
            continue;
        }
        match c {
            '\'' | '"' => quote = Some(c),
            '(' if chars[i + 1..].iter().find(|ch| !ch.is_whitespace()) == Some(&')') => {
                return true;
            }
            _ => {}
        }
    }
    false
}

/// Whether a PowerShell segment reads a member, index or method of a
/// variable outside quotes (`$x.Invoke()`, `$a[0]`, `$t::Run()`). In argument
/// mode PowerShell evaluates these, and a property or method can run code
/// (`$ExecutionContext.InvokeCommand.InvokeScript(...)`). Inside double
/// quotes only the variable itself expands, so those are plain.
fn has_member_access(seg: &str) -> bool {
    let chars: Vec<char> = seg.chars().collect();
    let mut quote: Option<char> = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        match c {
            '\'' | '"' => quote = Some(c),
            '$' => {
                let mut j = i + 1;
                if chars.get(j) == Some(&'{') {
                    match chars[j..].iter().position(|&ch| ch == '}') {
                        Some(end) => j += end + 1,
                        None => return true,
                    }
                } else {
                    while j < chars.len()
                        && (chars[j].is_ascii_alphanumeric()
                            || chars[j] == '_'
                            || (chars[j] == ':' && chars.get(j + 1) != Some(&':')))
                    {
                        j += 1;
                    }
                }
                if matches!(chars.get(j), Some('.' | '[' | '(' | ':')) {
                    return true;
                }
                i = j;
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    false
}

fn is_windows_opaque(base: &str) -> bool {
    WINDOWS_OPAQUE.contains(&windows_name(base).as_str())
}

/// Whether any token names PowerShell's `function:` or `alias:` drive, as a
/// path or as a variable. Writing there redefines a command for the rest of
/// the script, as `Set-Alias` does: `Set-Item function:ls ...`,
/// `New-Item alias:ls ...`, `$function:ls = '...'`.
///
/// Matched anywhere in the token, not as a prefix: PowerShell binds
/// `-AnyParam:value` (aliases and shortened names included), reaches the drive
/// through provider paths (`...\Function::ls`), and the assignment target may
/// be typed or braced (`[scriptblock]$function:ls`, `${function:ls}`). A
/// harmless token that merely mentions `alias:` prompts, which is the safe side.
fn touches_function_drive(tokens: &[String]) -> bool {
    tokens.iter().any(|t| {
        let lower = t.to_ascii_lowercase();
        lower.contains("function:") || lower.contains("alias:")
    })
}

/// `base` as Windows resolves it: case-insensitive and without `.exe`.
fn windows_name(base: &str) -> String {
    let lower = base.to_ascii_lowercase();
    lower.strip_suffix(".exe").unwrap_or(&lower).to_string()
}

/// GNU `time`'s getopt spec is `+af:o:pqvV`: only `-f`/`--format` and
/// `-o`/`--output` take a separate value; `-a`, `-p`, `-q`, `-v`, `-V` do
/// not and may combine into one cluster (`-aqvV`). Whether `t` is entirely
/// made of those no-value flags, so anything else (an unknown flag, a
/// cluster containing `f` or `o`, or a `--` abbreviation of `--format`/
/// `--output` such as `--out`) is treated as ambiguous rather than missed.
fn is_time_plain_flag(t: &str) -> bool {
    const LONG: &[&str] = &["--append", "--portability", "--quiet", "--verbose", "--version"];
    if let Some(short) = t.strip_prefix('-').filter(|s| !s.starts_with('-')) {
        return !short.is_empty() && short.chars().all(|c| "apqvV".contains(c));
    }
    LONG.contains(&t)
}

/// Whether `seg` holds a brace outside quotes and outside a `${...}` variable.
/// Such a brace is a PowerShell script block (`& { ... }`, `%{ ... }`,
/// `try{...}finally{...}`) or a POSIX `{ ...; }` group, whose contents are not
/// split into segments: scanning would yield the brace, the keyword before it,
/// or a fused token like `%{echo`, and a grant on that would cover any block.
///
/// Deliberately broad. Brace expansion (`*.{rs,toml}`) also counts, and so
/// prompts every time, because telling it apart from an unspaced script block
/// would need a PowerShell parser. Quoted braces (JSON, `awk '{...}'`, `jq`)
/// and `${HOME}` are not blocks.
fn has_block(seg: &str) -> bool {
    // POSIX shells read `\"` inside a double-quoted string as an escaped quote;
    // PowerShell reads it as a literal backslash that closes the string. A
    // brace one reading keeps inside quotes can be live under the other, so
    // either reading finding a block is enough.
    has_block_with(seg, true) || has_block_with(seg, false)
}

/// [`has_block`] under one quoting rule: whether `\` escapes a quote inside
/// a double-quoted string (`posix_escapes`) or is literal, as in PowerShell.
fn has_block_with(seg: &str, posix_escapes: bool) -> bool {
    let chars: Vec<char> = seg.chars().collect();
    let mut quote: Option<char> = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if let Some(q) = quote {
            if posix_escapes && c == '\\' && q == '"' {
                i += 1;
            } else if c == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        match c {
            '\\' if posix_escapes => i += 1,
            '\'' | '"' => quote = Some(c),
            // `${NAME}` (and `${NAME:-x}`) is a variable, not a block: skip to
            // its closing brace. A `${` that never closes counts as a block.
            '$' if chars.get(i + 1) == Some(&'{') => {
                match chars[i + 2..].iter().position(|&ch| ch == '}') {
                    Some(end) => i += 2 + end,
                    None => return true,
                }
            }
            '{' | '}' => return true,
            _ => {}
        }
        i += 1;
    }
    false
}

/// Whether `command` has a backtick outside single quotes. POSIX reads it as a
/// command substitution, PowerShell as its escape character (`` `' `` is a
/// literal quote, `` `; `` a literal semicolon), so the two disagree about
/// where strings and commands end and no single scan is right for both. Inside
/// single quotes both read it literally. Checked under both quoting rules, as
/// [`has_block`] is, since `\"` decides whether a `'` is inside a string.
fn has_live_backtick(command: &str) -> bool {
    has_live_backtick_with(command, true) || has_live_backtick_with(command, false)
}

/// [`has_live_backtick`] under one quoting rule; see [`has_block_with`].
fn has_live_backtick_with(command: &str, posix_escapes: bool) -> bool {
    let chars: Vec<char> = command.chars().collect();
    let mut quote: Option<char> = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match quote {
            Some('\'') => {
                if c == '\'' {
                    quote = None;
                }
            }
            Some(q) => {
                if c == '`' {
                    return true;
                }
                if posix_escapes && c == '\\' {
                    i += 1;
                } else if c == q {
                    quote = None;
                }
            }
            None => match c {
                '`' => return true,
                '\\' if posix_escapes => i += 1,
                '\'' | '"' => quote = Some(c),
                _ => {}
            },
        }
        i += 1;
    }
    false
}

/// PowerShell assignment operators, when written as their own token.
const PS_ASSIGN_OPS: &[&str] = &["=", "+=", "-=", "*=", "/=", "%=", "??="];

/// For a token that can start a PowerShell assignment target -- a variable
/// (`$x`, `$a.b`, `$env:X`, `${x}`, `$a[0]`) or a typed one (`[int]$x`) --
/// what follows a fused `=`: `Some("rm")` for `$x=rm`, `Some("")` for `$x=`
/// or a bare target (the caller then checks for an operator token). `None`
/// for anything else. Compound operators (`+=`, `??=`) end in the same `=`,
/// and PowerShell compares with `-eq`, so the first `=` is the operator.
fn ps_assignment_rest(token: &str) -> Option<&str> {
    if !(token.starts_with('$') || token.starts_with('[')) {
        return None;
    }
    Some(token.find('=').map_or("", |eq| &token[eq + 1..]))
}

/// `find` predicates that run an arbitrary command.
const EXEC_PREDICATES: &[&str] = &["-exec", "-execdir", "-ok", "-okdir"];
/// POSIX shells: `<shell> -c "<cmd>"` runs `<cmd>`, so we recurse into it.
const SHELLS: &[&str] = &["sh", "bash", "dash", "zsh", "ksh", "ash"];
/// Prefix commands and shell keywords that precede the real command; we skip
/// them (and their flags) to reach the command they wrap.
const WRAPPERS: &[&str] = &[
    "nice", "nohup", "setsid", "time", "timeout", "stdbuf", "ionice", "chrt",
    "command", "builtin", "exec", "then", "else", "elif", "do", "if", "while",
    "until", "for", "case", "select", "coproc", "!",
];
/// [`WRAPPERS`] with a flag that takes a separate value.
const VALUE_FLAG_WRAPPERS: &[&str] =
    &["nice", "timeout", "stdbuf", "ionice", "chrt", "exec", "time"];

/// Typographic quotes PowerShell accepts as `'` (U+2018-U+201B) and `"`
/// (U+201C-U+201E), each closing a string any of its class opened.
const PS_UNICODE_QUOTES: &[char] =
    &['\u{2018}', '\u{2019}', '\u{201A}', '\u{201B}', '\u{201C}', '\u{201D}', '\u{201E}'];

/// [`scan_command_as`] for the shell the `shell` tool actually runs.
pub fn scan_command(command: &str) -> CommandScan {
    scan_command_as(command, proc::shell().kind)
}

/// Reduce `command` to the bases it runs under a shell of `kind`. Mostly
/// shell-independent; `kind` decides only names whose meaning differs between
/// shells.
pub fn scan_command_as(command: &str, kind: ShellKind) -> CommandScan {
    // POSIX shells read these as plain characters, so the quote tracking here
    // (block detection, segment splitting) would disagree with PowerShell about
    // where a string ends: in `echo 'a\u{2019}; rm x; \u{2019}'` PowerShell runs
    // `rm`. They are rare in real commands, so prompting costs little.
    if command.contains(PS_UNICODE_QUOTES) || has_live_backtick(command) {
        return CommandScan::Opaque;
    }
    // Bash's ANSI-C quoting (`$'\''`) lets `\'` escape a quote inside a
    // single-quoted string, which every quote tracker here reads as the
    // string's end. Matched anywhere, even inside quotes, since telling those
    // apart needs the same tracking: `echo 'cost $'` prompts, harmlessly.
    if command.contains("$'") {
        return CommandScan::Opaque;
    }
    let mut bases = BTreeSet::new();
    if scan_into(command, &mut bases, kind, 0) {
        CommandScan::Bases(bases)
    } else {
        CommandScan::Opaque
    }
}

/// Collect the bases of `command` into `bases`. Returns `false` the moment an
/// opaque construct is hit, which aborts the whole scan.
fn scan_into(command: &str, bases: &mut BTreeSet<String>, kind: ShellKind, depth: usize) -> bool {
    if depth > 8 {
        return false;
    }
    // Before extraction, which drops `$((...))` and splits on the parens of
    // `(( ))` and `name()`.
    if has_arithmetic(command, kind != ShellKind::PowerShell)
        || has_empty_parens(command)
        || has_compound_assignment(command)
    {
        return false;
    }
    // `[[ $n -eq 1 ]]` evaluates `$n`'s value as arithmetic. Checked over
    // the whole command, not per segment: segment splitting cuts `[[ ]]` at
    // its own `&&`/`||`, so `[[ x && git -eq $n ]]` would leave the operator
    // in a segment with no `[[`. A `[[` is found as a substring because a
    // control operator can be fused to it (`true;[[`). A `-eq` elsewhere in
    // a command that has a `[[` also prompts, which is the safe side.
    if command.contains("[[")
        && tokenize(command, true).iter().any(|t| ARITHMETIC_TESTS.contains(&t.as_str()))
    {
        return false;
    }
    let (outer, subs) = extract_substitutions(command);
    for sub in subs {
        if !scan_into(&sub, bases, kind, depth + 1) {
            return false;
        }
    }
    // An unquoted `\` escapes the next character in POSIX shells and is a
    // literal in PowerShell, so in `ls C:\; rm x` PowerShell runs `rm`. When the
    // two readings split the command differently, one of them hides a command.
    let segments = split_segments(&outer, true);
    if segments != split_segments(&outer, false) {
        return false;
    }
    for seg in segments {
        if !scan_segment(&seg, bases, kind, depth) {
            return false;
        }
    }
    true
}

/// Pull `$(...)`, backtick, and `<(...)`/`>(...)` substitutions out of `s` for
/// separate scanning, replacing each with a space. `$((...))` arithmetic runs
/// no command and is dropped. Substitutions inside single quotes are literal
/// and left in place.
fn extract_substitutions(s: &str) -> (String, Vec<String>) {
    let chars: Vec<char> = s.chars().collect();
    let mut outer = String::with_capacity(s.len());
    let mut subs = Vec::new();
    let mut i = 0;
    let mut quote: Option<char> = None;
    while i < chars.len() {
        let c = chars[i];
        if quote == Some('\'') {
            if c == '\'' {
                quote = None;
            }
            outer.push(c);
            i += 1;
            continue;
        }
        match c {
            '\\' if i + 1 < chars.len() => {
                outer.push(c);
                outer.push(chars[i + 1]);
                i += 2;
            }
            '\'' if quote.is_none() => {
                quote = Some('\'');
                outer.push(c);
                i += 1;
            }
            '"' => {
                quote = if quote == Some('"') { None } else { Some('"') };
                outer.push(c);
                i += 1;
            }
            '`' => {
                let (inner, next) = capture_backtick(&chars, i);
                subs.push(inner);
                outer.push(' ');
                i = next;
            }
            '$' if i + 1 < chars.len() && chars[i + 1] == '(' => {
                if i + 2 < chars.len() && chars[i + 2] == '(' {
                    // $((...)) arithmetic: no command.
                    i = skip_balanced(&chars, i + 2);
                    outer.push(' ');
                } else {
                    let (inner, next) = capture_balanced(&chars, i + 1);
                    subs.push(inner);
                    outer.push(' ');
                    i = next;
                }
            }
            '<' | '>' if i + 1 < chars.len() && chars[i + 1] == '(' => {
                let (inner, next) = capture_balanced(&chars, i + 1);
                subs.push(inner);
                outer.push(' ');
                i = next;
            }
            _ => {
                outer.push(c);
                i += 1;
            }
        }
    }
    (outer, subs)
}

/// From an opening `(` at `open`, return (inner-without-parens, index-after-`)`).
fn capture_balanced(chars: &[char], open: usize) -> (String, usize) {
    let mut depth = 1;
    let mut inner = String::new();
    let mut j = open + 1;
    while j < chars.len() && depth > 0 {
        match chars[j] {
            '(' => {
                depth += 1;
                inner.push('(');
            }
            ')' => {
                depth -= 1;
                if depth > 0 {
                    inner.push(')');
                }
            }
            c => inner.push(c),
        }
        j += 1;
    }
    (inner, j)
}

/// From an opening `(` at `open`, return the index just past its matching `)`.
fn skip_balanced(chars: &[char], open: usize) -> usize {
    let mut depth = 1;
    let mut j = open + 1;
    while j < chars.len() && depth > 0 {
        match chars[j] {
            '(' => depth += 1,
            ')' => depth -= 1,
            _ => {}
        }
        j += 1;
    }
    j
}

fn capture_backtick(chars: &[char], tick: usize) -> (String, usize) {
    let mut inner = String::new();
    let mut j = tick + 1;
    while j < chars.len() && chars[j] != '`' {
        if chars[j] == '\\' && j + 1 < chars.len() {
            inner.push(chars[j + 1]);
            j += 2;
        } else {
            inner.push(chars[j]);
            j += 1;
        }
    }
    (inner, (j + 1).min(chars.len()))
}

/// Split on the shell control operators that separate commands, honoring
/// quotes. `(`/`)` (subshell grouping; substitutions are already removed) also
/// separate. `posix_escapes`: whether an unquoted `\` escapes the next
/// character (POSIX) or is a literal (PowerShell).
fn split_segments(s: &str, posix_escapes: bool) -> Vec<String> {
    let chars: Vec<char> = s.chars().collect();
    let mut segs = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
            cur.push(c);
            i += 1;
            continue;
        }
        match c {
            '\'' | '"' => {
                quote = Some(c);
                cur.push(c);
                i += 1;
            }
            '\\' if posix_escapes && i + 1 < chars.len() => {
                cur.push(c);
                cur.push(chars[i + 1]);
                i += 2;
            }
            ';' | '\n' | '|' | '&' | '(' | ')' => {
                segs.push(std::mem::take(&mut cur));
                i += 1;
            }
            _ => {
                cur.push(c);
                i += 1;
            }
        }
    }
    segs.push(cur);
    segs.into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Resolve one simple command segment to its base(s). Returns `false` if it is
/// opaque.
fn scan_segment(seg: &str, bases: &mut BTreeSet<String>, kind: ShellKind, depth: usize) -> bool {
    let tokens = tokenize(seg, true);
    // PowerShell reads `\` literally, so `C:\Windows\System32\cmd.exe` is
    // `cmd.exe` to it but an escaped `C:WindowsSystem32cmd.exe` to the POSIX
    // reading. Both readings must name the same command (checked below).
    let literal = tokenize(seg, false);
    // Any command-running find predicate makes the whole segment opaque.
    if tokens.iter().any(|t| EXEC_PREDICATES.contains(&t.as_str())) {
        return false;
    }
    // So does a script block or brace group anywhere in it: `try { ... }` and
    // `if ($x) { ... }` put the block after a keyword the scan would stop at.
    // `find -exec`'s `{}` placeholder has already made the segment opaque.
    if has_block(seg) {
        return false;
    }
    // Checked over the whole segment, before an assignment hands its
    // right-hand side to a rescan: in `$function:ls = '...'` the target is
    // the redefinition, and only the value would be scanned.
    if touches_function_drive(&tokens) || touches_function_drive(&literal) {
        return false;
    }
    if kind == ShellKind::PowerShell && has_member_access(seg) {
        return false;
    }
    let mut idx = 0;
    let mut guard = 0;
    loop {
        guard += 1;
        if guard > 64 {
            return false;
        }
        while idx < tokens.len() && is_assignment(&tokens[idx]) {
            // `PATH=/tmp/x ls` runs a different `ls`.
            if assigns_resolution_var(&tokens[idx]) {
                return false;
            }
            idx += 1;
        }
        // PowerShell `$var = <command>` (also `$a.b = ...`, `+=`, `$x=cmd`):
        // the command is the right-hand side, so that is what gets scanned.
        // Using `$var` as the base would let a grant on it cover any command
        // assigned to it.
        // A bare type cast before the target (`[string] $x = ...`).
        if tokens.get(idx).is_some_and(|t| t.starts_with('[') && t.ends_with(']'))
            && tokens.get(idx + 1).is_some_and(|t| t.starts_with('$'))
        {
            idx += 1;
        }
        // A .NET static call (`[Diagnostics.Process]::Start('x')`) can start
        // any program or touch any file, whatever its arguments.
        if tokens.get(idx).is_some_and(|t| t.starts_with('[') && t.contains("::")) {
            return false;
        }
        // Only PowerShell has `$var = <cmd>` and `[type]$var` assignments. In
        // bash a leading `$x` or `[k]=v` is a command word (`$x` runs what it
        // holds) and is opaque below.
        let ps_assignment = (kind == ShellKind::PowerShell)
            .then(|| tokens.get(idx).and_then(|t| ps_assignment_rest(t)))
            .flatten();
        if let Some(rest) = ps_assignment {
            if ps_target_is_resolution(&tokens[idx]) {
                return false;
            }
            let fused_op = tokens[idx].contains('=');
            let spaced_op = !fused_op
                && tokens.get(idx + 1).is_some_and(|t| PS_ASSIGN_OPS.contains(&t.as_str()));
            if spaced_op {
                // `$var = <cmd>`: what follows the operator token.
                let rhs = tokens[idx + 2..].join(" ");
                return scan_segment(&rhs, bases, kind, depth + 1);
            }
            if fused_op || !rest.is_empty() {
                // `$var=<cmd>` / `$var= <cmd>`: the value fused to the
                // operator, if any, then the remaining tokens.
                let mut rhs: Vec<String> = Vec::new();
                if !rest.is_empty() {
                    rhs.push(rest.to_string());
                }
                rhs.extend_from_slice(&tokens[idx + 1..]);
                return scan_segment(&rhs.join(" "), bases, kind, depth + 1);
            }
        }
        // A variable as the command (`& $cmd`, `& $env:ComSpec /c ...`) runs
        // whatever it holds, so a grant on its name would cover every later
        // value: always prompt.
        if tokens.get(idx).is_some_and(|t| t.starts_with('$')) {
            return false;
        }
        if idx >= tokens.len() {
            return true; // only assignments / empty: runs nothing
        }
        let base = strip_base(&tokens[idx]);
        if literal.len() != tokens.len() || strip_base(&literal[idx]) != base {
            return false;
        }
        if base.is_empty() {
            return true;
        }
        // An assignment the skip above did not take (`a[$i]=x`, `PS4+=x`):
        // bash evaluates the subscript, and an appended value is code too.
        // A command word built at run time (`l$x`, `/bin/r?`) names whatever
        // it expands to, so a grant on its text would cover every value.
        let word = tokens[idx].as_str();
        if word != "[" && word != "[[" && word.contains(['=', '$', '*', '?', '[']) {
            return false;
        }
        // Windows resolves `SSH` and `ssh.exe` to `ssh`, so the POSIX list is
        // matched by that name too.
        if OPAQUE.contains(&base.as_str())
            || OPAQUE.contains(&windows_name(&base).as_str())
            || is_windows_opaque(&base)
            || (kind == ShellKind::PowerShell
                && POWERSHELL_ONLY_OPAQUE.contains(&windows_name(&base).as_str()))
        {
            return false;
        }
        let args = &tokens[idx + 1..];
        if ASSIGNING_BUILTINS.contains(&windows_name(&base).as_str()) && assigns_unsafely(args) {
            return false;
        }
        // `printf -v 'a[$(rm x)]'` and `test -v 'a[...]'` evaluate a
        // subscript; `wait -p` assigns to a name.
        let names_a_var = match base.as_str() {
            // The name may be attached to the flag (`-v'a[$(rm x)]'`), and
            // `wait`'s flags combine (`-np x`).
            "printf" | "test" | "[" | "[[" => args.iter().any(|t| t.starts_with("-v")),
            "wait" => args.iter().any(|t| {
                t.starts_with('-') && !t.starts_with("--") && t.contains('p')
            }),
            _ => false,
        };
        if names_a_var {
            return false;
        }
        if base == "env" {
            idx += 1;
            while idx < tokens.len() && is_assignment(&tokens[idx]) {
                if assigns_resolution_var(&tokens[idx]) {
                    return false;
                }
                idx += 1;
            }
            // `env -flag ...` can consume the command with a value-flag we can't
            // model; be safe and prompt.
            if idx < tokens.len() && tokens[idx].starts_with('-') {
                return false;
            }
            continue;
        }
        if SHELLS.contains(&base.as_str()) || SHELLS.contains(&windows_name(&base).as_str()) {
            if let Some(p) = tokens[idx + 1..].iter().position(|t| t == "-c") {
                let c_arg = idx + 1 + p + 1;
                return match tokens.get(c_arg) {
                    Some(cmd) => scan_into(cmd, bases, kind, depth + 1),
                    None => false,
                };
            }
            bases.insert(base);
            return true;
        }
        if WRAPPERS.contains(&base.as_str()) {
            idx += 1;
            // Skip the wrapper's flags, numeric args (durations/priorities), and
            // any inline assignments to reach the wrapped command.
            while idx < tokens.len() {
                let t = &tokens[idx];
                let numeric = |t: &str| t.chars().next().is_some_and(|c| c.is_ascii_digit());
                if is_assignment(t) && assigns_resolution_var(t) {
                    return false;
                }
                if t == "--" {
                    idx += 1;
                    break;
                }
                // A bare flag followed by a word may take that word as its
                // value (`timeout -s KILL 5 rm`, `exec -a ls rm`), so which
                // token is the command is ambiguous. Attached values
                // (`-oL`, `--signal=KILL`) are not. `time` is checked by
                // `is_time_plain_flag` instead, which whitelists its
                // no-value flags so unknown/combined/abbreviated spellings
                // default to ambiguous rather than being missed.
                let value_flag = if base.as_str() == "time" {
                    t.starts_with('-') && !is_time_plain_flag(t)
                } else {
                    (t.len() == 2 && t.starts_with('-') && !numeric(&t[1..]))
                        || (t.starts_with("--") && !t.contains('='))
                };
                if value_flag
                    && VALUE_FLAG_WRAPPERS.contains(&base.as_str())
                    && tokens.get(idx + 1).is_some_and(|n| !n.starts_with('-') && !numeric(n))
                {
                    return false;
                }
                if t.starts_with('-') || numeric(t) || is_assignment(t) {
                    idx += 1;
                } else {
                    break;
                }
            }
            continue;
        }
        // A path names one file, not whatever a bare name resolves to, so it
        // stays part of the base: a grant on `ls` must not cover `./ls`.
        // (A `\` path already prompts: the two readings of `\` disagree.)
        if literal[idx].contains('/') {
            bases.insert(literal[idx].clone());
        } else {
            bases.insert(base);
        }
        return true;
    }
}

/// Split a segment into whitespace-delimited tokens, stripping quotes and,
/// with `posix_escapes`, resolving backslash escapes (else `\` is literal, as
/// in PowerShell).
fn tokenize(s: &str, posix_escapes: bool) -> Vec<String> {
    let chars: Vec<char> = s.chars().collect();
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut has = false;
    let mut quote: Option<char> = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if let Some(q) = quote {
            if c == q {
                quote = None;
            } else if posix_escapes && c == '\\' && q == '"' && i + 1 < chars.len() {
                cur.push(chars[i + 1]);
                has = true;
                i += 2;
                continue;
            } else {
                cur.push(c);
                has = true;
            }
            i += 1;
            continue;
        }
        match c {
            '\'' | '"' => {
                quote = Some(c);
                has = true;
                i += 1;
            }
            '\\' if posix_escapes && i + 1 < chars.len() => {
                cur.push(chars[i + 1]);
                has = true;
                i += 2;
            }
            c if c.is_whitespace() => {
                if has {
                    out.push(std::mem::take(&mut cur));
                    has = false;
                }
                i += 1;
            }
            _ => {
                cur.push(c);
                has = true;
                i += 1;
            }
        }
    }
    if has {
        out.push(cur);
    }
    out
}

fn is_assignment(t: &str) -> bool {
    let Some(eq) = t.find('=') else {
        return false;
    };
    if eq == 0 {
        return false;
    }
    t[..eq]
        .chars()
        .enumerate()
        .all(|(i, c)| c == '_' || c.is_ascii_alphabetic() || (i > 0 && c.is_ascii_digit()))
}

fn strip_base(t: &str) -> String {
    t.rsplit(['/', '\\']).next().unwrap_or(t).to_string()
}

/// Collapse runs of whitespace so equivalent opaque commands share one key.
pub fn normalize(command: &str) -> String {
    command.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bases(command: &str) -> BTreeSet<String> {
        match scan_command(command) {
            CommandScan::Bases(b) => b,
            CommandScan::Opaque => panic!("expected Bases for {command:?}, got Opaque"),
        }
    }

    fn set(items: &[&str]) -> BTreeSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn simple_command() {
        assert_eq!(bases("ls -la"), set(&["ls"]));
    }

    #[test]
    fn a_path_is_its_own_base() {
        assert_eq!(bases("/usr/bin/git commit -m x"), set(&["/usr/bin/git"]));
    }

    #[test]
    fn compound_and_exposes_hidden_command() {
        assert_eq!(bases("git status && rm -rf ~"), set(&["git", "rm"]));
    }

    #[test]
    fn pipes_and_semicolons_and_newlines() {
        assert_eq!(bases("cat f | grep x"), set(&["cat", "grep"]));
        assert_eq!(bases("a; b\nc"), set(&["a", "b", "c"]));
        assert_eq!(bases("a || b && c"), set(&["a", "b", "c"]));
    }

    #[test]
    fn leading_env_assignments_are_skipped() {
        assert_eq!(bases("FOO=bar BAZ=1 node app.js"), set(&["node"]));
    }

    #[test]
    fn env_wrapper_with_assignments() {
        assert_eq!(bases("env A=1 B=2 python run.py"), set(&["python"]));
    }

    #[test]
    fn env_with_flag_is_opaque() {
        assert_eq!(scan_command("env -i rm -rf /"), CommandScan::Opaque);
    }

    #[test]
    fn timeout_and_nice_unwrap_to_inner_command() {
        assert_eq!(bases("timeout 5 curl http://x"), set(&["curl"]));
        assert_eq!(bases("nice -n 10 make"), set(&["make"]));
        assert_eq!(bases("nohup node server.js"), set(&["node"]));
    }

    #[test]
    fn subshell_group() {
        assert_eq!(bases("(cd sub && rm f)"), set(&["cd", "rm"]));
    }

    #[test]
    fn command_substitution_is_scanned() {
        assert_eq!(bases("echo $(rm x)"), set(&["echo", "rm"]));
        // A backtick is a substitution to POSIX and an escape to PowerShell;
        // no one scan is right for both, so it prompts.
        assert_eq!(scan_command("echo `rm x`"), CommandScan::Opaque);
    }

    #[test]
    fn substitution_in_single_quotes_is_literal() {
        assert_eq!(bases("echo '$(rm x)'"), set(&["echo"]));
    }

    #[test]
    fn substitution_in_double_quotes_runs() {
        assert_eq!(bases("echo \"$(rm x)\""), set(&["echo", "rm"]));
    }

    #[test]
    fn arithmetic_is_not_a_command() {
        assert_eq!(bases("echo $((1 + 2))"), set(&["echo"]));
    }

    #[test]
    fn inline_shell_c_is_recursed() {
        assert_eq!(bases("bash -c 'rm -rf x'"), set(&["rm"]));
        assert_eq!(bases("sh -c \"git push && rm y\""), set(&["git", "rm"]));
    }

    #[test]
    fn eval_and_sudo_and_xargs_are_opaque() {
        assert_eq!(scan_command("eval \"$CMD\""), CommandScan::Opaque);
        assert_eq!(scan_command("sudo rm -rf /"), CommandScan::Opaque);
        assert_eq!(scan_command("ls | xargs rm"), CommandScan::Opaque);
        assert_eq!(scan_command("source ./x.sh"), CommandScan::Opaque);
    }

    #[test]
    fn find_exec_is_opaque() {
        assert_eq!(
            scan_command("find . -name '*.tmp' -exec rm {} ;"),
            CommandScan::Opaque
        );
        // plain find (no command-running predicate) resolves normally
        assert_eq!(bases("find . -name '*.rs'"), set(&["find"]));
    }

    /// On Windows the shell may be PowerShell, so a grant on `powershell` or
    /// `iex` would cover any code at all; those always prompt, in any case.
    #[test]
    fn windows_shells_and_powershell_evaluators_are_opaque() {
        for command in [
            "powershell -Command Remove-Item -Recurse C:\\",
            "PowerShell.exe -c x",
            "pwsh -c x",
            "cmd /c del x",
            "CMD.EXE /c del x",
            "Invoke-Expression $x",
            "iex $x",
            "Invoke-Command { rm x }",
            "Start-Process notepad",
            "Get-ChildItem | ForEach-Object { Remove-Item $_ }",
            "ls | % { rm $_ }",
            "ls | Where-Object { $_.Length -gt 0 }",
            "Start-Job { rm x }",
            "git status; iex $x",
            // A script block or brace group is code this scanner does not
            // split, so a grant on one must not cover every other block.
            "& { Remove-Item -Recurse ~ }",
            "if ($x) { Remove-Item a }",
            "try { rm x } catch { }",
            "{ ls; rm -rf ~; }",
            "{ls}",
            "try{ rm x }",
            "%{echo $_}",
            "ls | %{a}{b}",
            "try{a}finally{b}",
            "ls *.{rs,toml}",
            // PowerShell does not escape `\"`: the string closes there, so the
            // block after it is live.
            r#"Select-Object -InputObject "C:\" -Property { Remove-Item -Recurse ~ }"#,
            r#"Sort-Object -InputObject "a\" { Remove-Item -Recurse ~ }"#,
            // PowerShell closes a string at a typographic quote of its class.
            "Sort-Object -InputObject \"abc\u{201D} { Remove-Item -Recurse ~ } \"\"",
            "echo 'a\u{2019} ; rm x ; \u{2019}'",
            // PowerShell's backtick escape: `' is a literal quote, so the
            // `;` after it is live.
            "echo `'`' ; Remove-Item -Recurse -Force ~",
            "echo \"a`\" ; rm x ; \"",
            "echo a`; rm x",
            // PowerShell reads `\` literally, so the separator or quote after
            // it is live.
            "ls C:\\; Remove-Item -Recurse -Force ~",
            "ls C:\\| rm x",
            "echo \\' x '; Remove-Item ~",
            // Starting a program by another name.
            "[Diagnostics.Process]::Start('x')",
            "[System.IO.File]::Delete('C:\\x')",
            "Invoke-Item x.exe",
            "ii x.exe",
            "Invoke-WmiMethod -Class Win32_Process -Name Create -ArgumentList calc.exe",
            "iwmi -Class Win32_Process -Name Create -ArgumentList calc.exe",
            "Invoke-CimMethod -ClassName Win32_Process -MethodName Create",
            "icim -ClassName Win32_Process -MethodName Create",
            "ssh.exe host rm -rf ~",
            "SSH host x",
            "sudo.exe rm x",
            "forfiles /c \"cmd /c del @file\"",
            "wmic process call create calc.exe",
            "schtasks /create /tr calc.exe /tn x /sc once /st 00:00",
            "runas /user:x calc.exe",
            "msiexec /i x.msi",
            "explorer.exe x.exe",
            // An alias or function defined earlier renames a later base.
            "Set-Alias ls Remove-Item; ls -Recurse -Force ~",
            "sal ls rm; ls x",
            "New-Alias ls rm",
            "nal ls rm",
            "Set-Item function:ls -Value x",
            "New-Item -Path alias:ls -Value Remove-Item",
            // Any colon-bound parameter, alias or shortened name included.
            "Set-Item -LP:function:ls -Value 'echo a; Remove-Item -Recurse ~'; ls",
            "Set-Item -PSPath:function:ls -Value x",
            "Set-Item -Pa:Alias:ls -Value x",
            "Set-Item Microsoft.PowerShell.Core\\Function::ls -Value x",
            // The variable namespace redefines the same way.
            "$function:ls = 'echo hi; Remove-Item -Recurse -Force ~'; ls",
            "${function:ls} = 'x'; ls",
            "$Alias:ls = 'Remove-Item'",
            "[scriptblock]$function:ls = 'x'",
            "New-PSDrive -Name F -PSProvider Function -Root ''; Set-Item F:ls -Value 'Remove-Item -Recurse ~'; ls",
            "ndr F Function ''",
            // A provider path can be built at run time, out of the text.
            "$a = echo function; Set-Item \"${a}:git\" -Value 'Remove-Item -Recurse -Force ~'; git status",
            "Set-Item x -Value y",
            "si x y",
            "New-Item -ItemType File a.txt",
            "ni a.txt",
            "Copy-Item a b",
            "cpi a b",
            "Rename-Item a b",
            "rni a b",
            "Move-Item a b",
            "mi a b",
            "$a = echo function; Set-Content \"${a}:git\" 'Remove-Item ~'; git status",
            "Set-Content a.txt x",
            "Add-Content a.txt x",
            "ac a.txt x",
            "Clear-Content a.txt",
            "clc a.txt",
            // A module's functions shadow a program of the same name.
            "echo 'function git { rm x }' > x.psm1; Import-Module ./x.psm1; git status",
            "ipmo ./x.psm1",
            // A bash alias redefines a later, already granted command.
            "shopt -s expand_aliases\nalias ls='rm -rf ~'\nls",
            "alias ls='rm -rf ~'",
            "shopt -s expand_aliases",
            "wsl rm -rf ~",
            "bash.exe -c 'iex x'",
            "mshta x.hta",
            "rundll32 x.dll,Entry",
            // A full path names the same program; PowerShell reads `\` literally.
            "C:\\Windows\\System32\\cmd.exe /c del /s /q C:\\",
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -c x",
            // A variable as the command runs whatever it holds.
            "& $env:ComSpec /c dir",
            "& $cmd args",
            "$cmd",
            "git status; & $x",
        ] {
            assert_eq!(scan_command(command), CommandScan::Opaque, "{command}");
        }
        // An ordinary cmdlet is still a base that a grant can cover.
        assert_eq!(bases("Get-ChildItem -Recurse"), set(&["Get-ChildItem"]));
        // Reading a function or a path that merely ends in `function` is not
        // a redefinition.
        assert_eq!(bases("git log --grep function"), set(&["git"]));
        assert_eq!(bases("cat src/function.rs"), set(&["cat"]));
        // The POSIX file commands are PowerShell's item cmdlets only under
        // PowerShell, where a provider path can be built at run time.
        for kind in [ShellKind::Posix, ShellKind::Cmd] {
            assert_eq!(
                scan_command_as("cp a b && mv b c", kind),
                CommandScan::Bases(set(&["cp", "mv"])),
                "{kind:?}"
            );
        }
        for command in [
            "cp a b",
            "copy a b",
            "mv a b",
            "move a b",
            "ren a b",
            "CP.exe a b",
            "$a = echo alias; cp x \"${a}:ls\"; ls",
        ] {
            assert_eq!(
                scan_command_as(command, ShellKind::PowerShell),
                CommandScan::Opaque,
                "{command}"
            );
        }
        // Quoted braces and `${...}` variables are not blocks.
        for (command, base) in [
            (r#"echo '{"a":1}'"#, "echo"),
            ("jq '{a: .b}' f.json", "jq"),
            ("awk '{print $1}' f", "awk"),
            ("echo ${HOME}", "echo"),
            ("echo ${HOME:-/root} ${USER}", "echo"),
            (r#"curl -d "{\"x\":1}" u"#, "curl"),
        ] {
            assert_eq!(bases(command), set(&[base]), "{command}");
        }
    }

    /// A PowerShell assignment runs its right-hand side, so that is the base:
    /// a grant on the variable must not cover whatever is assigned to it.
    #[test]
    fn a_powershell_assignment_scans_its_right_hand_side() {
        for (command, base) in [
            ("$files = Get-ChildItem", "Get-ChildItem"),
            ("$x=rm -rf ~", "rm"),
            ("$x= rm -rf ~", "rm"),
            ("$x ??= Get-Item a", "Get-Item"),
            ("[string]$x = rm -rf ~", "rm"),
            ("[int] $x = Remove-Item a", "Remove-Item"),
            ("${x} = rm -rf ~", "rm"),
            ("[int]$x=Get-Item a", "Get-Item"),
        ] {
            assert_eq!(
                scan_command_as(command, ShellKind::PowerShell),
                CommandScan::Bases(set(&[base])),
                "{command}"
            );
            // Bash has no such assignment: `$x = rm` runs what `$x` holds.
            assert_eq!(
                scan_command_as(command, ShellKind::Posix),
                CommandScan::Opaque,
                "{command}"
            );
        }
        assert_eq!(scan_command_as("[$i]=git", ShellKind::Posix), CommandScan::Opaque);
        // A property or element target can run a setter, so under PowerShell
        // it is not a plain assignment.
        for command in ["$a.b += Remove-Item x", "$a[0] = rm -rf ~", "$a[0]=rm -rf ~"] {
            assert_eq!(
                scan_command_as(command, ShellKind::PowerShell),
                CommandScan::Opaque,
                "{command}"
            );
        }
        // `&` splits segments, so a bare `$x` reads like `& $x`: it prompts.
        assert_eq!(scan_command("$x | rm y"), CommandScan::Opaque);
        assert_eq!(
            scan_command_as("$x =", ShellKind::PowerShell),
            CommandScan::Bases(set(&[])),
            "nothing to run, so nothing a grant covers"
        );
    }

    /// janhq/jan#9142: a grant covers a segment only while it is a plain
    /// invocation. Every way to change what a granted name runs, or to run a
    /// variable's value as code, prompts instead.
    #[test]
    fn only_plain_invocations_are_covered_by_a_grant() {
        let opaque = |command: &str, kind: ShellKind| {
            assert_eq!(scan_command_as(command, kind), CommandScan::Opaque, "{command} ({kind:?})");
        };
        let plain = |command: &str, kind: ShellKind, expected: &[&str]| {
            assert_eq!(
                scan_command_as(command, kind),
                CommandScan::Bases(set(expected)),
                "{command} ({kind:?})"
            );
        };
        for kind in [ShellKind::Posix, ShellKind::PowerShell, ShellKind::Cmd] {
            for command in [
                // Function definitions, with any body.
                "function git { rm -rf ~; }; git status",
                "function git ( rm -rf ~ ); git status",
                "git() ( rm -rf ~ ); git status",
                "git () ( rm -rf ~ )",
                "filter git { rm x }",
                // Builtins that repoint a name or run their argument.
                "hash -p /bin/rm ls; ls -rf ~",
                "enable -f ./x.so ls; ls",
                "trap 'rm -rf ~' EXIT; ls",
                "bind -x '\"a\": rm x'",
                "complete -C 'rm x' ls",
                "fc -s ls=rm",
                "declare -n x=y",
                "typeset a",
                "local x=1",
                "readonly x=1",
                "let x=1",
                "mapfile -t a < f",
                // Arithmetic evaluates a variable's value as code.
                "echo $((x + 1))",
                "(( x++ ))",
                "[[ $n -eq 1 ]] && ls",
                "[[ -v 'a[$(rm x)]' ]]",
                "[[ x && git -eq $n ]]",
                "[[ x || y -lt $n ]] && ls",
                "true;[[ $n -eq 1 ]]",
                "true&&[[ $n -gt 1 ]]",
                "(x)||[[ $n -ne 1 ]]",
                "echo \"'\"; a=(git [$i]=y); echo \"'\"",
                "printf -v 'a[$(rm x)]' x",
                "printf -v'a[$(rm -rf ~)]' x",
                "wait -np x",
                "wait -p x",
                // A `'` inside double quotes does not open a string.
                "echo \"'\" $(( $(rm -rf ~) )) \"'\"",
                "echo \"$((x))\"",
                "read 'a[$(rm x)]'",
                "a[$(rm x)]=1 ls",
                // Lookup variables decide which program a name runs.
                "PATH=/tmp/evil:$PATH ls",
                "export PATH=/tmp/evil",
                "export BASH_ENV=./x.sh; bash x",
                "LD_PRELOAD=./x.so ls",
                "env PATH=/tmp ls",
                "unset PATH",
                "nice PATH=/tmp ls",
                "set PATH=C:\\evil",
                "path C:\\evil",
                // janhq/jan#9149: `time -o FILE cmd` writes to `FILE` and
                // runs `cmd`, not `FILE`; `-o` must not be skipped as an
                // ordinary flag. `-f`/`--format` take a value too, and so
                // does `-o` combined into a short-flag cluster (`-ao`) or
                // spelled as a getopt_long abbreviation (`--out`).
                "time -o ls rm -rf ~",
                "command time -o ls rm -rf ~",
                "/usr/bin/time -o ls rm x",
                "time -f ls rm -rf ~",
                "time -ao ls rm -rf ~",
                "time --out ls rm -rf ~",
                "time --format ls rm -rf ~",
                "time --forma ls rm -rf ~",
                "time -zo ls rm -rf ~",
                // A command word built at run time.
                "l$x -la",
                "/bin/r? x",
                // A wrapper flag may take the next word as its value.
                "timeout -s KILL 5 rm x",
                "exec -a ls rm x",
            ] {
                opaque(command, kind);
            }
            // The ordinary, everyday commands are still plain.
            plain("git status && cargo test -- --nocapture", kind, &["cargo", "git"]);
            plain("export RUST_LOG=debug; echo $HOME", kind, &["echo", "export"]);
            plain("FOO=1 npm run build", kind, &["npm"]);
            plain("echo $((1 + 2))", kind, &["echo"]);
            plain("echo \"((x))\" '$((x))'", kind, &["echo"]);
            plain("echo ${a[0]} ${a[@]} ${#a[*]} ${x:1} ${x: -2:1}", kind, &["echo"]);
            plain("echo ${x:-def} ${x:=d} ${x:+y} ${x//[a-z]/} ${x#*:}", kind, &["echo"]);
            plain("echo ${#x} ${#} ${?} ${@} ${x%.*} ${x^^} ${x,} ${x-d}", kind, &["echo"]);
            plain("printf '%s' x; wait -n", kind, &["printf", "wait"]);
            plain("[ -f x ] && cat x", kind, &["[", "cat"]);
            plain("[[ -f x ]]", kind, &["[["]);
            plain("timeout 5 curl u", kind, &["curl"]);
            plain("timeout --signal=KILL 5 curl u", kind, &["curl"]);
            plain("nice -n 10 make", kind, &["make"]);
            plain("stdbuf -oL make", kind, &["make"]);
            // janhq/jan#9149: `time`'s no-value flags still yield its
            // wrapped command.
            plain("time -p ls", kind, &["ls"]);
            plain("time -aqvV ls", kind, &["ls"]);
            plain("time --verbose ls", kind, &["ls"]);
            plain("read -r line < f", kind, &["read"]);
            plain("echo \"$(git rev-parse HEAD)\"", kind, &["echo", "git"]);
            // A path stays the base: `./ls` is not the granted `ls`.
            plain("./ls -la", kind, &["./ls"]);
            plain("/usr/bin/git status", kind, &["/usr/bin/git"]);
            plain("ls", kind, &["ls"]);
        }
        // Subscripts and offsets in a bash parameter expansion are
        // arithmetic too. In PowerShell `${...}` only names a variable.
        for command in [
            "echo ${a[$i]}",
            "echo ${a[i]}",
            "echo \"${#a[n]}\"",
            "echo ${x:$n}",
            "echo ${x:1:n}",
            "echo ${a[0]:$n}",
            "read x < f; echo ${x@P}",
            "echo \"${x@P}\"",
            "echo ${!x}",
            "echo ${!pre*}",
            "echo $[x]",
            "echo \"$[x + 1]\"",
            "echo $'\\'' $((x)) $'\\''",
            "echo $'\\'' ; rm -rf ~ ; $'\\''",
            // A compound array assignment evaluates its `[key]=` subscripts.
            "read i < f; a=([$i]=git); git status",
            "a+=([$i]=x)",
            "declare -A m; m[k]=1; b=(x y)",
            "FOO=(a) ls",
        ] {
            opaque(command, ShellKind::Posix);
        }
        plain("echo ${a[$i]}", ShellKind::PowerShell, &["echo"]);
        // `set` is `Set-Variable` in PowerShell, and options in bash.
        plain("set -euo pipefail", ShellKind::Posix, &["set"]);
        opaque("set -Name PATH -Value x", ShellKind::PowerShell);
        // PowerShell: a member access can run code, and these variables
        // change what a later command does.
        for command in [
            "$ExecutionContext.InvokeCommand.InvokeScript('rm x')",
            "echo $ExecutionContext.InvokeCommand.InvokeScript('rm x')",
            "Write-Output $x.Invoke()",
            "Write-Output ${x}.Invoke()",
            "echo $t::Run()",
            "Set-Variable -Name PATH -Value x",
            "sv x y",
            "New-Variable x y",
            "Add-Type -TypeDefinition $src",
            "Update-TypeData -TypeName x -MemberType ScriptProperty",
            "$env:PATH = 'C:\\evil'; git status",
            "$env:Path += ';C:\\evil'",
            "[string]$env:PATH = 'x'",
            "$global:PSDefaultParameterValues = @{}",
            "$PSDefaultParameterValues['*:Path'] = 'x'",
            "${env:PATH} = 'x'",
            "C:\\tools\\l$x.exe",
        ] {
            opaque(command, ShellKind::PowerShell);
        }
        // Inside double quotes only the variable expands, which is plain.
        plain("Write-Output \"$x.Name\"", ShellKind::PowerShell, &["Write-Output"]);
        plain("Write-Output $env:USERPROFILE", ShellKind::PowerShell, &["Write-Output"]);
        plain("Write-Output ${env:USERPROFILE}", ShellKind::PowerShell, &["Write-Output"]);
        plain("./build.ps1 -Release", ShellKind::PowerShell, &["./build.ps1"]);
    }

    /// janhq/jan#9149: cmd strips `^` from every token before acting on it,
    /// so `set PA^TH=...` and `setx` can still change `PATH` even though the
    /// literal assignment name does not match `PATH`.
    #[test]
    fn cmd_caret_and_setx_assignments_are_opaque() {
        for command in [
            "set PA^TH=C:\\evil& git status",
            "setx PATH C:\\evil & git status",
            "setx PA^TH C:\\evil & git status",
        ] {
            assert_eq!(scan_command_as(command, ShellKind::Cmd), CommandScan::Opaque, "{command}");
        }
        // The un-escaped, quoted form was already caught before #9149.
        assert_eq!(
            scan_command_as("set \"PATH=C:\\evil\" & git status", ShellKind::Cmd),
            CommandScan::Opaque
        );
    }

    #[test]
    fn empty_command_has_no_bases() {
        assert_eq!(bases(""), set(&[]));
        assert_eq!(bases("   "), set(&[]));
    }
}
