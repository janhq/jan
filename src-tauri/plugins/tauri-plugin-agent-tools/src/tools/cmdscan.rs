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
/// `find` predicates that run an arbitrary command.
const EXEC_PREDICATES: &[&str] = &["-exec", "-execdir", "-ok", "-okdir"];
/// POSIX shells: `<shell> -c "<cmd>"` runs `<cmd>`, so we recurse into it.
const SHELLS: &[&str] = &["sh", "bash", "dash", "zsh", "ksh", "ash"];
/// Prefix commands and shell keywords that precede the real command; we skip
/// them (and their flags) to reach the command they wrap.
const WRAPPERS: &[&str] = &[
    "nice", "nohup", "setsid", "time", "timeout", "stdbuf", "ionice", "chrt", "command", "builtin",
    "exec", "then", "else", "elif", "do", "if", "while", "until", "for", "case", "function",
    "select", "coproc", "!",
];

pub fn scan_command(command: &str) -> CommandScan {
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
    for seg in split_segments(&outer) {
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
/// separate.
fn split_segments(s: &str) -> Vec<String> {
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
            '\\' if i + 1 < chars.len() => {
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
    let tokens = tokenize(seg);
    // Any command-running find predicate makes the whole segment opaque.
    if tokens.iter().any(|t| EXEC_PREDICATES.contains(&t.as_str())) {
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
        if idx >= tokens.len() {
            return true; // only assignments / empty: runs nothing
        }
        let base = strip_base(&tokens[idx]);
        if base.is_empty() {
            return true;
        }
        if OPAQUE.contains(&base.as_str()) {
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
        if SHELLS.contains(&base.as_str()) {
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

/// Split a segment into whitespace-delimited tokens, stripping quotes and
/// resolving backslash escapes.
fn tokenize(s: &str) -> Vec<String> {
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
            } else if c == '\\' && q == '"' && i + 1 < chars.len() {
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
            '\\' if i + 1 < chars.len() => {
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
        assert_eq!(bases("echo `rm x`"), set(&["echo", "rm"]));
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

    #[test]
    fn empty_command_has_no_bases() {
        assert_eq!(bases(""), set(&[]));
        assert_eq!(bases("   "), set(&[]));
    }
}
