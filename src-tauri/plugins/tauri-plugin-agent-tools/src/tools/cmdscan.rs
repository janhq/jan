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

use std::collections::BTreeSet;

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
const OPAQUE: &[&str] = &[
    "eval", "xargs", "source", ".", "sudo", "su", "doas", "ssh", "watch",
];
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
    // Hosts that run a program or script named in their arguments.
    "wsl", "conhost", "cscript", "wscript", "mshta", "rundll32",
];

fn is_windows_opaque(base: &str) -> bool {
    WINDOWS_OPAQUE.contains(&windows_name(base).as_str())
}

/// `base` as Windows resolves it: case-insensitive and without `.exe`.
fn windows_name(base: &str) -> String {
    let lower = base.to_ascii_lowercase();
    lower.strip_suffix(".exe").unwrap_or(&lower).to_string()
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
    "until", "for", "case", "function", "select", "coproc", "!",
];

/// Typographic quotes PowerShell accepts as `'` (U+2018-U+201B) and `"`
/// (U+201C-U+201E), each closing a string any of its class opened.
const PS_UNICODE_QUOTES: &[char] =
    &['\u{2018}', '\u{2019}', '\u{201A}', '\u{201B}', '\u{201C}', '\u{201D}', '\u{201E}'];

pub fn scan_command(command: &str) -> CommandScan {
    // POSIX shells read these as plain characters, so the quote tracking here
    // (block detection, segment splitting) would disagree with PowerShell about
    // where a string ends: in `echo 'a\u{2019}; rm x; \u{2019}'` PowerShell runs
    // `rm`. They are rare in real commands, so prompting costs little.
    if command.contains(PS_UNICODE_QUOTES) || has_live_backtick(command) {
        return CommandScan::Opaque;
    }
    let mut bases = BTreeSet::new();
    if scan_into(command, &mut bases, 0) {
        CommandScan::Bases(bases)
    } else {
        CommandScan::Opaque
    }
}

/// Collect the bases of `command` into `bases`. Returns `false` the moment an
/// opaque construct is hit, which aborts the whole scan.
fn scan_into(command: &str, bases: &mut BTreeSet<String>, depth: usize) -> bool {
    if depth > 8 {
        return false;
    }
    let (outer, subs) = extract_substitutions(command);
    for sub in subs {
        if !scan_into(&sub, bases, depth + 1) {
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
        if !scan_segment(&seg, bases, depth) {
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
fn scan_segment(seg: &str, bases: &mut BTreeSet<String>, depth: usize) -> bool {
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
    let mut idx = 0;
    let mut guard = 0;
    loop {
        guard += 1;
        if guard > 64 {
            return false;
        }
        while idx < tokens.len() && is_assignment(&tokens[idx]) {
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
        if let Some(rest) = tokens.get(idx).and_then(|t| ps_assignment_rest(t)) {
            let fused_op = tokens[idx].contains('=');
            let spaced_op = !fused_op
                && tokens.get(idx + 1).is_some_and(|t| PS_ASSIGN_OPS.contains(&t.as_str()));
            if spaced_op {
                // `$var = <cmd>`: what follows the operator token.
                let rhs = tokens[idx + 2..].join(" ");
                return scan_segment(&rhs, bases, depth + 1);
            }
            if fused_op || !rest.is_empty() {
                // `$var=<cmd>` / `$var= <cmd>`: the value fused to the
                // operator, if any, then the remaining tokens.
                let mut rhs: Vec<String> = Vec::new();
                if !rest.is_empty() {
                    rhs.push(rest.to_string());
                }
                rhs.extend_from_slice(&tokens[idx + 1..]);
                return scan_segment(&rhs.join(" "), bases, depth + 1);
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
        if OPAQUE.contains(&base.as_str()) || is_windows_opaque(&base) {
            return false;
        }
        if base == "env" {
            idx += 1;
            while idx < tokens.len() && is_assignment(&tokens[idx]) {
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
                    Some(cmd) => scan_into(cmd, bases, depth + 1),
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
                let numeric = t.chars().next().is_some_and(|c| c.is_ascii_digit());
                if t.starts_with('-') || numeric || is_assignment(t) {
                    idx += 1;
                } else {
                    break;
                }
            }
            continue;
        }
        bases.insert(base);
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
    fn strips_directory_prefix() {
        assert_eq!(bases("/usr/bin/git commit -m x"), set(&["git"]));
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
            ("$a.b += Remove-Item x", "Remove-Item"),
            ("$x ??= Get-Item a", "Get-Item"),
        ] {
            assert_eq!(bases(command), set(&[base]), "{command}");
        }
        for (command, base) in [
            ("[string]$x = rm -rf ~", "rm"),
            ("[int] $x = Remove-Item a", "Remove-Item"),
            ("${x} = rm -rf ~", "rm"),
            ("$a[0] = rm -rf ~", "rm"),
            ("$a[0]=rm -rf ~", "rm"),
            ("[int]$x=Get-Item a", "Get-Item"),
        ] {
            assert_eq!(bases(command), set(&[base]), "{command}");
        }
        // `&` splits segments, so a bare `$x` reads like `& $x`: it prompts.
        assert_eq!(scan_command("$x | rm y"), CommandScan::Opaque);
        assert!(bases("$x =").is_empty(), "nothing to run, so nothing a grant covers");
    }

    #[test]
    fn empty_command_has_no_bases() {
        assert_eq!(bases(""), set(&[]));
        assert_eq!(bases("   "), set(&[]));
    }
}
