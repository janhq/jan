use std::path::{Path, PathBuf};

/// True iff `raw` resolves to a path outside `project_root` and outside the
/// session scratch. Relative paths are resolved against `project_root`.
/// Canonicalizes (resolving `..` and symlinks) so string tricks and symlink
/// escapes are caught. For a not-yet-existing leaf (new-file writes), the
/// deepest existing ancestor is canonicalized and the remaining tail re-joined.
pub fn escapes_project(
    project_root: &Path,
    scratch: Option<&Path>,
    raw: &str,
) -> Result<bool, String> {
    let root = project_root
        .canonicalize()
        .map_err(|e| format!("project root {:?}: {e}", project_root))?;
    let abs = if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        root.join(raw)
    };
    let resolved = canonicalize_lenient(&abs)?;
    if resolved.starts_with(&root) {
        return Ok(false);
    }
    // The scratch is the agent's own per-session area and is writable under
    // every backend at this same real path, so a path landing in it is not a
    // host escape even though it sits outside the project. Canonicalized, so
    // a symlink the shell planted in the scratch cannot lead back out. A
    // scratch that cannot be canonicalized grants nothing: the path stays an
    // escape.
    if let Some(scratch) = scratch {
        if let Ok(scratch) = scratch.canonicalize() {
            return Ok(!resolved.starts_with(&scratch));
        }
    }
    Ok(true)
}

/// True iff `raw` escapes every root a *read* may legitimately reach: the
/// project, the scratch, or any attached read-only root.
///
/// Layered on [`escapes_project`] rather than replacing it, so the write path
/// keeps the exact check it has today and a read root can only ever widen what
/// reads reach, never what writes do.
///
/// A read root that cannot be canonicalized grants nothing — same rule as the
/// scratch above. A vanished root must not silently open a path up.
pub fn escapes_read_roots(
    project_root: &Path,
    scratch: Option<&Path>,
    read_roots: &[PathBuf],
    raw: &str,
) -> Result<bool, String> {
    if !escapes_project(project_root, scratch, raw)? {
        return Ok(false);
    }
    if read_roots.is_empty() {
        return Ok(true);
    }
    let abs = if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        // Relative paths belong to the workspace, never to an attached folder:
        // resolving them against a read root would make `write` and `read`
        // disagree about what one path means.
        project_root.join(raw)
    };
    let resolved = canonicalize_lenient(&abs)?;
    for root in read_roots {
        if let Ok(root) = root.canonicalize() {
            if resolved.starts_with(&root) {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

/// True iff `raw` escapes every root a *write* may legitimately reach: the
/// project, the scratch, or any attached root the caller marked writable.
///
/// The mirror image of [`escapes_read_roots`], layered on [`escapes_project`]
/// for the same reason: a writable root can only ever widen what writes reach,
/// and a caller that passes none keeps today's exact check. A root that cannot
/// be canonicalized grants nothing.
pub fn escapes_write_roots(
    project_root: &Path,
    scratch: Option<&Path>,
    write_roots: &[PathBuf],
    raw: &str,
) -> Result<bool, String> {
    if !escapes_project(project_root, scratch, raw)? {
        return Ok(false);
    }
    if write_roots.is_empty() {
        return Ok(true);
    }
    let abs = if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        // Relative paths belong to the workspace, never to an attached folder
        // -- the same rule reads follow, so one path means one place to both.
        project_root.join(raw)
    };
    let resolved = canonicalize_lenient(&abs)?;
    for root in write_roots {
        if let Ok(root) = root.canonicalize() {
            if resolved.starts_with(&root) {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

/// Resolve a tool-supplied path to its on-disk location: absolute paths as
/// given, relative ones against the project. The scratch needs no mapping: the
/// sandbox exposes it at its real path, so the shell and the tools already
/// agree on its name.
pub fn resolve_path(project_root: &Path, raw: &str) -> PathBuf {
    if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        project_root.join(raw)
    }
}

/// Why `name` cannot safely be a file name on Windows, or `None` if it can.
///
/// The tools address files through a `\\?\` path (the project root is one), and
/// Windows skips its name normalisation for those. A name Win32 would have
/// rewritten is then created exactly as given: `aux` and `con.txt` are
/// reserved device names and `name.` loses its dot, so every ordinary Windows
/// tool (PowerShell, Explorer, `del`) reports the path as not found, and a
/// `:` addresses an NTFS alternate data stream that no directory listing shows.
/// The tool would still report success, so the model believes the file exists.
///
/// Platform-independent on purpose, so it is testable anywhere; callers gate it
/// with [`refuse_windows_name`].
pub fn windows_name_problem(name: &str) -> Option<&'static str> {
    if name.contains(':') {
        return Some("contains ':' (an NTFS alternate data stream, not a file)");
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return Some("ends with a dot or a space, which Windows silently strips");
    }
    // Reserved with or without an extension: `con.txt` is as reserved as `con`.
    let stem = name.split('.').next().unwrap_or(name).trim_end_matches(' ');
    let upper = stem.to_ascii_uppercase();
    // COM1-9 and LPT1-9; Windows also reserves the superscript digits.
    let numbered = ["COM", "LPT"].iter().any(|prefix| {
        let mut digit = upper.strip_prefix(prefix).into_iter().flat_map(str::chars);
        matches!(
            (digit.next(), digit.next()),
            (Some('1'..='9' | '\u{b9}' | '\u{b2}' | '\u{b3}'), None)
        )
    });
    let reserved =
        numbered || matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$");
    reserved.then_some("is a reserved Windows device name")
}

/// On Windows, the first component of `raw` that is not a valid file name, with
/// the reason; `None` elsewhere and for a path that is fine. Drive and root
/// components are not names, and `.`/`..` are resolved before they reach disk.
pub fn refuse_windows_name(raw: &str) -> Option<(String, &'static str)> {
    if !cfg!(windows) {
        return None;
    }
    use std::path::Component;
    Path::new(raw).components().find_map(|c| match c {
        Component::Normal(name) => {
            let name = name.to_string_lossy();
            windows_name_problem(&name).map(|why| (name.into_owned(), why))
        }
        _ => None,
    })
}

/// True iff `path` lexically sits inside the session scratch. Lexical on
/// purpose: it names a path the tools are about to create as well as one that
/// already exists.
pub fn in_scratch(scratch: Option<&Path>, path: &Path) -> bool {
    scratch.is_some_and(|s| lexical_normalize(path).starts_with(lexical_normalize(s)))
}

/// Resolve `.`/`..` without touching the filesystem, so a path is comparable to
/// the project root even when the target does not exist yet. Purely lexical:
/// `canonicalize` would also follow symlinks and fail on missing files.
pub fn lexical_normalize(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// True iff a write to `raw` would land in a read-only `project_root`: inside
/// it and not in the session scratch (which a read-only subagent still writes
/// to). Fails closed: a path that cannot be resolved counts as inside.
pub fn in_read_only_root(project_root: &Path, scratch: Option<&Path>, raw: &str) -> bool {
    let target = resolve_path(project_root, raw);
    let Ok(resolved) = canonicalize_lenient(&target) else {
        return true;
    };
    if let Some(scratch) = scratch.and_then(|s| s.canonicalize().ok()) {
        if resolved.starts_with(&scratch) {
            return false;
        }
    }
    match project_root.canonicalize() {
        Ok(root) => resolved.starts_with(root),
        Err(_) => true,
    }
}

/// True iff `raw` resolves inside `hidden` (the Jan home, `~/.jan`), which holds
/// `config.toml` with provider keys and hooks plus every project's store. The
/// memory/skill tools reach the store by name and never come through here.
///
/// One exception: a project that itself lives under `hidden` (a Jan worktree in
/// `~/.jan/worktrees/`) is the agent's working tree, so paths inside it stay
/// reachable. The home itself as the project grants nothing.
pub fn in_hidden_root(project_root: &Path, hidden: &Path, raw: &str) -> bool {
    in_hidden_root_from(project_root, project_root, hidden, raw)
}

/// [`in_hidden_root`] with a relative `raw` resolved against `base` instead of
/// the project root: a shell that a `cd` moved elsewhere reads `.jan/...`
/// from there. The worktree exception stays keyed on `project_root`, since
/// that, not where the shell stands, is the agent's working tree.
pub fn in_hidden_root_from(project_root: &Path, base: &Path, hidden: &Path, raw: &str) -> bool {
    let Ok(hidden) = canonicalize_lenient(hidden) else {
        return false;
    };
    let Ok(resolved) = canonicalize_lenient(&resolve_path(base, raw)) else {
        return false;
    };
    if !resolved.starts_with(&hidden) {
        return false;
    }
    match project_root.canonicalize() {
        Ok(root) if root != hidden && root.starts_with(&hidden) => !resolved.starts_with(&root),
        _ => true,
    }
}

/// The path-like tokens of a shell command (best-effort), `~` and `$HOME`
/// expanded against the home `hidden` sits in, since that is the obvious way
/// to spell a path under it. The gate refuses a command when one of them is
/// in the hidden root; best-effort is enough only because the OS sandbox
/// masks the directory too (see [`super::jail::Policy::hide_root`]).
///
/// A word in command position without a `/` (`ls`, `git`, `cd`) is left out:
/// the shell looks it up on `PATH`, never in the working directory, so it
/// names no path there. Read as one, it resolves under wherever a `cd` left
/// the shell, and a shell held in a folder under the home would have every
/// later command refused, `cd /proj` included. A slashed command word
/// (`./run.sh`, `~/.jan/x`) is a path and stays.
pub fn hidden_tokens(hidden: &Path, command: &str) -> Vec<String> {
    let mut scan = Scan {
        home: hidden.parent().map(|h| h.to_string_lossy().into_owned()),
        at_command: true,
        ..Scan::default()
    };
    scan.run(&command.chars().collect::<Vec<_>>());
    scan.tokens
}

/// What a [`Scan`] is nested in, which decides what closes it and which
/// characters still act inside it.
#[derive(Clone, Copy, PartialEq)]
enum Nest {
    /// `(...)`, `$(...)` or `<(...)`: a command list, closed by `)`.
    Paren,
    /// A backtick substitution: a command list, closed by the next backtick.
    Backtick,
    /// `"..."`: one string, in which only `$(`, a backtick, `\` and `"` act.
    Double,
}

/// The tokenizer behind [`hidden_tokens`]. A word is dropped only when it is
/// certainly a plain, unquoted command name at a real command boundary: a
/// separator that is quoted, escaped or part of a redirect starts no command,
/// and a substitution's end leaves the command it sits in going. Getting
/// that wrong drops an argument from the check, so whenever the shell's
/// reading is in doubt the word is kept.
#[derive(Default)]
struct Scan {
    home: Option<String>,
    tokens: Vec<String>,
    word: Word,
    nests: Vec<Nest>,
    // At the start of a command: the next word is its name.
    at_command: bool,
    // After `<`/`>`: the next word is a file, wherever the redirect sits.
    redirect: bool,
    // After `<<`: the next word is a heredoc's delimiter; true for `<<-`,
    // which strips the body's leading tabs.
    delimiter_next: Option<bool>,
    // Heredocs whose bodies start on the next line: (delimiter, strip tabs).
    heredocs: Vec<(String, bool)>,
}

impl Scan {
    fn run(&mut self, chars: &[char]) {
        let mut i = 0;
        while let Some(&c) = chars.get(i) {
            i += 1;
            let next = chars.get(i).copied();
            if self.nests.last() == Some(&Nest::Double) {
                match c {
                    '"' => {
                        self.nests.pop();
                        self.word.mark(c);
                    }
                    '\\' => i += self.escape(next),
                    '`' => self.open(Nest::Backtick),
                    '(' if unescaped_dollar(&chars[..i - 1]) => self.open(Nest::Paren),
                    _ if breaks_token(c) => self.word.split(c),
                    _ => self.word.push(c),
                }
                continue;
            }
            match c {
                '\\' => i += self.escape(next),
                '\'' => {
                    self.word.mark(c);
                    while let Some(&q) = chars.get(i) {
                        i += 1;
                        match q {
                            '\'' => break,
                            '\\' => self.word.drop_backslash(),
                            _ if breaks_token(q) => self.word.split(q),
                            _ => self.word.push(q),
                        }
                    }
                    self.word.mark(c);
                }
                '"' => {
                    self.nests.push(Nest::Double);
                    self.word.mark(c);
                }
                '`' if self.nests.last() == Some(&Nest::Backtick) => self.close(Nest::Backtick),
                '`' => self.open(Nest::Backtick),
                '(' => self.open(Nest::Paren),
                ')' => self.close(Nest::Paren),
                '&' if next == Some('>') => {
                    // `&>` and `&>>` redirect both streams; no command follows.
                    self.finish_word();
                    self.redirect = true;
                    i += 1 + usize::from(chars.get(i + 1) == Some(&'>'));
                }
                // The second half of `||`, `&&` or `;;` lands here again,
                // which changes nothing.
                ';' | '|' | '&' | '\n' => {
                    self.finish_word();
                    self.at_command = true;
                    if c == '\n' {
                        i = self.heredoc_bodies(chars, i);
                    }
                }
                '<' | '>' => {
                    self.finish_word();
                    self.redirect = true;
                    match (c, next) {
                        // `<<<` feeds the next word as a string.
                        ('<', Some('<')) if chars.get(i + 1) == Some(&'<') => i += 2,
                        ('<', Some('<')) => {
                            let strip_tabs = chars.get(i + 1) == Some(&'-');
                            i += 1 + usize::from(strip_tabs);
                            self.delimiter_next = Some(strip_tabs);
                        }
                        // `>>`, `>|`, `>&`, `<&`, `<>`: one operator, so the
                        // `|` or `&` in it is no command boundary.
                        (_, Some('>' | '|' | '&')) => i += 1,
                        _ => {}
                    }
                }
                _ if c.is_whitespace() => self.finish_word(),
                _ => self.word.push(c),
            }
        }
        self.finish_word();
    }

    /// A backslash makes the next character literal, and joins the lines when
    /// that is a newline. Inside `"..."` it stays before most characters, but
    /// dropping it there too only checks the name a nested shell would see.
    /// Returns how many characters it consumed after itself.
    fn escape(&mut self, next: Option<char>) -> usize {
        match next {
            Some('\n') => 1,
            Some(c) => {
                self.word.literal(c);
                1
            }
            None => 0,
        }
    }

    fn open(&mut self, nest: Nest) {
        // `a=(x y)` lists values, not commands.
        let array = nest == Nest::Paren && self.word.raw.ends_with('=');
        // A word a substitution cuts into has a computed value, never a
        // plain command name.
        self.word.quoted = true;
        self.finish_word();
        self.nests.push(nest);
        self.at_command = !array;
        self.redirect = false;
    }

    fn close(&mut self, nest: Nest) {
        self.finish_word();
        if self.nests.last() == Some(&nest) {
            self.nests.pop();
        }
        // What follows a substitution or a subshell belongs to the command it
        // sits in, so it is an argument, not a new command's name.
        self.at_command = false;
    }

    /// Read the bodies of the heredocs opened on the line just ended, from
    /// `i`, and return where the next command starts. A body is data (`tar
    /// -T -` reads names from it), so all of its words are tokens.
    fn heredoc_bodies(&mut self, chars: &[char], mut i: usize) -> usize {
        for (delimiter, strip_tabs) in std::mem::take(&mut self.heredocs) {
            while i < chars.len() {
                let end = chars[i..]
                    .iter()
                    .position(|&c| c == '\n')
                    .map_or(chars.len(), |n| i + n);
                let line: String = chars[i..end].iter().collect();
                i = (end + 1).min(chars.len());
                let line = if strip_tabs { line.trim_start_matches('\t') } else { &line };
                if line == delimiter {
                    break;
                }
                let words: Vec<String> = line
                    .split(|c| breaks_token(c) || c == '=')
                    .filter(|t| !t.is_empty())
                    .map(|t| self.expand(t))
                    .collect();
                self.tokens.extend(words);
            }
        }
        i
    }

    /// Sort the word just read into `tokens`, moving `at_command` past the
    /// command's name.
    fn finish_word(&mut self) {
        let mut word = std::mem::take(&mut self.word);
        if word.raw.is_empty() {
            return;
        }
        word.end_piece();
        if let Some(strip_tabs) = self.delimiter_next.take() {
            self.heredocs.push((word.text.clone(), strip_tabs));
        }
        if std::mem::take(&mut self.redirect) {
            let paths: Vec<String> = word.pieces.iter().map(|p| self.expand(p)).collect();
            self.tokens.extend(paths);
            return;
        }
        if self.at_command {
            // `NAME=value` ahead of a command sets a variable: its value,
            // quoted or not, can name a path, and the command still follows.
            if let Some((name, _)) = word.raw.split_once('=') {
                let is_name = name
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                    && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
                if is_name {
                    let prefix = format!("{name}=");
                    if let Some(first) = word.pieces.first_mut() {
                        if let Some(value) = first.strip_prefix(&prefix) {
                            *first = value.to_string();
                        }
                    }
                    let values: Vec<String> = word
                        .pieces
                        .iter()
                        .filter(|p| !p.is_empty())
                        .map(|p| self.expand(p))
                        .collect();
                    self.tokens.extend(values);
                    return;
                }
            }
            // Reserved words leave the next word in command position.
            const KEYWORDS: &[&str] = &[
                "if", "then", "else", "elif", "fi", "do", "done", "while", "until", "!", "{", "}",
            ];
            if !word.quoted && KEYWORDS.contains(&word.raw.as_str()) {
                return;
            }
            self.at_command = false;
            if !word.quoted {
                let name = self.expand(&word.raw);
                if name.contains('/') {
                    self.tokens.push(name);
                }
                return;
            }
        }
        // An argument, or a command name the shell computes: `--file=path`
        // and `a=b` name paths on either side.
        let args: Vec<String> = word
            .pieces
            .iter()
            .flat_map(|p| p.split('='))
            .filter(|t| !t.is_empty())
            .map(|t| self.expand(t))
            .collect();
        self.tokens.extend(args);
    }

    fn expand(&self, token: &str) -> String {
        match &self.home {
            Some(home) => expand_home(token, home),
            None => token.to_string(),
        }
    }
}

/// True iff `before` ends in a `$` that no backslash escapes, so a `(` after
/// it opens a substitution even inside `"..."`.
fn unescaped_dollar(before: &[char]) -> bool {
    let Some((&'$', rest)) = before.split_last() else {
        return false;
    };
    rest.iter().rev().take_while(|&&c| c == '\\').count() % 2 == 0
}

/// True iff `c` ends a token inside quotes or a heredoc body without ending
/// the shell word: a quoted `'cat .jan/x'` is a script to `sh -c`, which
/// splits it there, so its parts are checked as the paths they may be.
fn breaks_token(c: char) -> bool {
    c.is_whitespace() || ";|&<>()\"'`".contains(c)
}

/// One shell word as [`Scan`] reads it, split into pieces where a nested
/// shell could split it.
#[derive(Default)]
struct Word {
    /// As written, quotes and backslashes included.
    raw: String,
    /// Quotes and backslashes removed: what a heredoc delimiter compares as.
    text: String,
    pieces: Vec<String>,
    piece: String,
    /// Quoted, escaped, expanded or cut by a substitution anywhere: not
    /// certainly a plain name.
    quoted: bool,
}

impl Word {
    fn push(&mut self, c: char) {
        self.quoted |= c == '$';
        self.raw.push(c);
        self.text.push(c);
        self.piece.push(c);
    }

    /// An escaped character: part of the word whatever it is.
    fn literal(&mut self, c: char) {
        self.quoted = true;
        self.raw.push('\\');
        self.raw.push(c);
        self.text.push(c);
        self.piece.push(c);
    }

    /// A backslash inside single quotes: literal to this shell, but a nested
    /// `sh -c '...'` drops it, and the name without it is the one to check.
    fn drop_backslash(&mut self) {
        self.raw.push('\\');
        self.text.push('\\');
    }

    /// A quote mark: ends the piece, as splitting on quotes always has.
    fn mark(&mut self, c: char) {
        self.quoted = true;
        self.raw.push(c);
        self.end_piece();
    }

    /// A quoted separator: ends the piece but not the word.
    fn split(&mut self, c: char) {
        self.raw.push(c);
        self.text.push(c);
        self.end_piece();
    }

    fn end_piece(&mut self) {
        if !self.piece.is_empty() {
            self.pieces.push(std::mem::take(&mut self.piece));
        }
    }
}

/// True iff `raw` resolves inside one of `roots` (canonicalized attached
/// folders). Relative paths belong to the project, never to a root.
pub fn in_attached_root(project_root: &Path, roots: &[PathBuf], raw: &str) -> bool {
    in_attached_root_from(project_root, project_root, roots, raw)
}

/// [`in_attached_root`] with a relative `raw` resolved against `base`, where
/// a `cd` left the shell: the same base [`in_hidden_root_from`] resolves it
/// against, so a shell standing in an attached root under the Jan home is
/// carved out by the same token that would hit the home. From the project
/// root itself a relative path still belongs to the project, never a root.
pub fn in_attached_root_from(
    project_root: &Path,
    base: &Path,
    roots: &[PathBuf],
    raw: &str,
) -> bool {
    if roots.is_empty() || (!Path::new(raw).is_absolute() && base == project_root) {
        return false;
    }
    let Ok(resolved) = canonicalize_lenient(&resolve_path(base, raw)) else {
        return false;
    };
    roots
        .iter()
        .filter_map(|r| r.canonicalize().ok())
        .any(|r| resolved.starts_with(r))
}

/// True iff the confined shell may name `raw` (relative to `base`) even
/// though it is in the Jan home: it sits in an attached read root the sandbox
/// mounts read-only, which a root also marked writable is not. The gate's
/// carve-out and the shell's choice of where it may stand both ask this, so
/// the shell never holds a directory the gate would then refuse every
/// command in.
pub fn shell_reads_attached_from(
    project_root: &Path,
    base: &Path,
    read_roots: &[PathBuf],
    write_roots: &[PathBuf],
    raw: &str,
) -> bool {
    in_attached_root_from(project_root, base, read_roots, raw)
        && !in_attached_root_from(project_root, base, write_roots, raw)
}

fn expand_home(token: &str, home: &str) -> String {
    for prefix in ["${HOME}", "$HOME", "~"] {
        if let Some(rest) = token.strip_prefix(prefix) {
            if rest.is_empty() || rest.starts_with('/') {
                return format!("{home}{rest}");
            }
        }
    }
    token.to_string()
}

/// `hidden` spelled under `base`, the way a directory walk rooted at `base`
/// names its entries, or `None` when the walk cannot reach it. Lets `ls`,
/// `find` and `grep` skip the Jan home with a prefix test per entry instead of
/// canonicalizing every file they visit.
pub fn hidden_under(base: &Path, hidden: &Path) -> Option<PathBuf> {
    let base_canon = base.canonicalize().ok()?;
    let hidden_canon = canonicalize_lenient(hidden).ok()?;
    let rest = hidden_canon.strip_prefix(&base_canon).ok()?;
    Some(base.join(rest))
}

/// True when `target` *claims* to be inside a trusted root but resolves outside
/// every one of them: the fail-closed re-check a handler runs immediately
/// before its final open, closing the window between the gate's
/// decision-time canonicalization and the handler's use of the raw path.
///
/// Containment, not symlink-avoidance: a link that stays beneath a trusted root
/// is ordinary and must keep working (a yarn workspace's
/// `node_modules/<pkg> -> ../../pkg` is one, and refusing those would make the
/// tools useless in a monorepo). Only a link whose target leaves the roots is an
/// escape.
///
/// A target that is not even lexically under a root is left alone: it is an
/// escape the gate already put to the user, and re-deciding it here would
/// override their approval. An unresolvable path fails closed.
///
/// Still a re-check, not a guarantee: a swap landing between this call and the
/// open is not covered. A handler that writes resolves once with [`landing`]
/// and opens the result through [`super::nofollow`], which closes that window.
pub fn symlink_escapes_root(project_root: &Path, scratch: Option<&Path>, target: &Path) -> bool {
    symlink_escapes_any_root(project_root, scratch, &[], target)
}

/// As [`symlink_escapes_root`], but also treating `read_roots` as trusted.
///
/// Passing the read roots is not optional once one is attached: a path inside
/// an attached folder is not lexically under the project or the scratch, so the
/// early return above would classify it as "already decided" and skip the check
/// entirely — leaving a link in the user's repo pointing at `~/.ssh` followed.
pub fn symlink_escapes_any_root(
    project_root: &Path,
    scratch: Option<&Path>,
    read_roots: &[PathBuf],
    target: &Path,
) -> bool {
    matches!(landing(project_root, scratch, read_roots, target), Landing::Escapes)
}

/// Where a handler's target really lands, see [`landing`].
#[derive(Debug, PartialEq, Eq)]
pub enum Landing {
    /// Under a trusted root, and resolves (every link followed) inside one.
    Inside(PathBuf),
    /// Claims a trusted root but resolves outside all of them, or cannot be
    /// resolved at all: refuse.
    Escapes,
    /// Not lexically under any root: an escape the gate already put to the
    /// user. Carries the real path when it resolves.
    Outside(Option<PathBuf>),
}

/// Resolve `target` once and classify it against the trusted roots.
///
/// A writer must open exactly the path this returns rather than re-resolving
/// `target`: two resolutions leave room for a link swapped in between to send
/// the second one somewhere the first was never checked against.
pub fn landing(
    project_root: &Path,
    scratch: Option<&Path>,
    roots: &[PathBuf],
    target: &Path,
) -> Landing {
    let mut all = vec![project_root];
    if let Some(s) = scratch {
        all.push(s);
    }
    for r in roots {
        all.push(r.as_path());
    }
    let normalized = lexical_normalize(target);
    if !all
        .iter()
        .any(|r| normalized.starts_with(lexical_normalize(r)))
    {
        return Landing::Outside(canonicalize_lenient(&normalized).ok());
    }
    let Ok(resolved) = canonicalize_lenient(&normalized) else {
        return Landing::Escapes;
    };
    if all
        .iter()
        .filter_map(|r| r.canonicalize().ok())
        .any(|r| resolved.starts_with(r))
    {
        Landing::Inside(resolved)
    } else {
        Landing::Escapes
    }
}

/// Canonicalize a path that may not fully exist, resolving `.`/`..` lexically
/// past the point where the path stops existing.
///
/// Walked one component at a time so every symlink on the way is followed,
/// including a dangling one: `canonicalize` fails on a link whose target does
/// not exist, yet a write through it creates that target. Re-appending such a
/// link by name would keep `notes.md -> ~/.ssh/authorized_keys` inside the
/// project. A link's target is spliced in place of its name instead, relative
/// targets against the link's own directory, as the kernel does. Too many hops
/// (a cycle) is an error, so callers fail closed.
pub(crate) fn canonicalize_lenient(path: &Path) -> Result<PathBuf, String> {
    use std::path::Component;
    // Linux's MAXSYMLINKS: the most hops `open` itself would follow.
    const MAX_HOPS: usize = 40;
    if let Ok(p) = path.canonicalize() {
        return Ok(p);
    }
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| format!("current dir: {e}"))?
            .join(path)
    };
    // Components still to resolve, next one last so a link splices onto the end.
    let mut pending: Vec<std::ffi::OsString> =
        abs.components().rev().map(|c| c.as_os_str().to_owned()).collect();
    let mut resolved = PathBuf::new();
    let mut hops = 0;
    while let Some(raw) = pending.pop() {
        match Path::new(&raw).components().next() {
            Some(Component::Prefix(_) | Component::RootDir) => {
                resolved.push(&raw);
                if let Ok(root) = resolved.canonicalize() {
                    resolved = root;
                }
            }
            Some(Component::ParentDir) => {
                resolved.pop();
            }
            Some(Component::Normal(name)) => {
                let candidate = resolved.join(name);
                if let Ok(real) = candidate.canonicalize() {
                    resolved = real;
                    continue;
                }
                let is_link = std::fs::symlink_metadata(&candidate)
                    .is_ok_and(|m| m.file_type().is_symlink());
                if !is_link {
                    // Does not exist: nothing below it can be a link either way.
                    resolved = candidate;
                    continue;
                }
                hops += 1;
                if hops > MAX_HOPS {
                    return Err(format!("too many levels of symbolic links in {:?}", path));
                }
                let target = std::fs::read_link(&candidate)
                    .map_err(|e| format!("read link {:?}: {e}", candidate))?;
                // An absolute target restarts from its own root when its
                // RootDir component is popped; a relative one stays here.
                pending.extend(target.components().rev().map(|c| c.as_os_str().to_owned()));
            }
            Some(Component::CurDir) | None => {}
        }
    }
    Ok(resolved)
}

#[cfg(test)]
mod windows_name_tests {
    use super::windows_name_problem as problem;

    #[test]
    fn reserved_device_names_are_refused_with_or_without_an_extension() {
        for n in [
            "con", "CON", "Prn", "aux", "NUL", "con.txt", "aux.tar.gz", "nul.", "CONIN$", "CONOUT$",
            "com1", "COM9", "lpt1", "LPT9", "com1.log", "com\u{b9}", "lpt\u{b2}.txt", "aux .txt",
        ] {
            assert!(problem(n).is_some(), "{n:?} should be refused");
        }
    }

    #[test]
    fn names_that_only_resemble_reserved_ones_are_fine() {
        for n in [
            "auxiliary", "console.log", "com0", "com10", "lpt0", "com", "lpt", "conf", "nulls.txt",
            "a.con", "my.aux", ".aux", "x.nul.y", "readme.md", ".gitignore", "a.b.c", "x y.txt",
        ] {
            assert_eq!(problem(n), None, "{n:?} should be accepted");
        }
    }

    #[test]
    fn trailing_dot_or_space_and_colon_are_refused() {
        for n in ["name.", "name ", "name.txt.", "a.txt:stream", "a.txt::$DATA", "C:x"] {
            assert!(problem(n).is_some(), "{n:?} should be refused");
        }
    }

    #[test]
    fn the_refusal_gives_a_reason_the_model_can_act_on() {
        assert!(problem("aux").unwrap().contains("reserved"));
        assert!(problem("a:b").unwrap().contains("stream"));
        assert!(problem("a.").unwrap().contains("dot or a space"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn unique_root() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("jan_sandbox_test_{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).expect("create test root");
        dir
    }

    /// A test dir that is *not* under the host temp dir, as the real scratch
    /// (in the OS cache dir) is not, so a `/tmp` path can be told apart from
    /// it. Lives under the crate's `target/`, which is already build output.
    fn unique_root_outside_tmp() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("sandbox-tests")
            .join(format!("{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).expect("create test scratch");
        dir
    }

    #[test]
    fn in_project_file_does_not_escape() {
        let root = unique_root();
        std::fs::write(root.join("inner.txt"), b"x").unwrap();
        assert_eq!(escapes_project(&root, None, "inner.txt"), Ok(false));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn nested_in_project_does_not_escape() {
        let root = unique_root();
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/inner.txt"), b"x").unwrap();
        assert_eq!(escapes_project(&root, None, "sub/inner.txt"), Ok(false));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn dotdot_escapes() {
        let root = unique_root();
        assert_eq!(escapes_project(&root, None, "../outside.txt"), Ok(true));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn absolute_outside_escapes() {
        let root = unique_root();
        let outside = std::env::temp_dir().join("definitely_outside_the_root.txt");
        assert_eq!(
            escapes_project(&root, None, outside.to_str().unwrap()),
            Ok(true)
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn absolute_inside_does_not_escape() {
        let root = unique_root();
        std::fs::write(root.join("inner.txt"), b"x").unwrap();
        let inside = root.join("inner.txt");
        assert_eq!(
            escapes_project(&root, None, inside.to_str().unwrap()),
            Ok(false)
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn new_file_in_project_dir_does_not_escape() {
        let root = unique_root();
        std::fs::create_dir_all(root.join("sub")).unwrap();
        assert_eq!(escapes_project(&root, None, "sub/newfile.txt"), Ok(false));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Nothing is mounted over `/tmp` any more, so a `/tmp/...` path is a
    /// plain host path: outside the project and the scratch it is an escape,
    /// and it resolves to itself rather than into the scratch.
    #[test]
    #[cfg(target_os = "linux")]
    fn tmp_is_a_plain_host_path_even_with_a_scratch() {
        let root = unique_root_outside_tmp();
        let scratch = unique_root_outside_tmp();
        assert_eq!(
            escapes_project(&root, Some(&scratch), "/tmp/ok.txt"),
            Ok(true),
            "the host /tmp is not the scratch"
        );
        assert_eq!(resolve_path(&root, "/tmp/a.txt"), Path::new("/tmp/a.txt"));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    /// The scratch, reached by its real path, is the agent's own area on
    /// every platform, so it must not read as an escape. The scratch sits
    /// outside the host temp dir, as the real one (in the OS cache dir) does.
    #[test]
    fn real_scratch_path_is_not_an_escape() {
        let root = unique_root();
        let scratch = unique_root_outside_tmp();
        let inside = scratch.join("notes.txt");
        assert_eq!(
            escapes_project(&root, Some(&scratch), inside.to_str().unwrap()),
            Ok(false),
            "a write into the session scratch is not a host escape"
        );
        assert_eq!(
            escapes_project(&root, Some(&scratch), scratch.to_str().unwrap()),
            Ok(false),
            "the scratch root itself is addressable"
        );
        // The allowance is the scratch, not its parent.
        let sibling = scratch.parent().unwrap().join("not_the_scratch.txt");
        assert_eq!(
            escapes_project(&root, Some(&scratch), sibling.to_str().unwrap()),
            Ok(true)
        );
        // And nothing changes for a caller with no scratch at all.
        assert_eq!(
            escapes_project(&root, None, inside.to_str().unwrap()),
            Ok(true)
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    /// The scratch check resolves symlinks: the shell can plant one inside
    /// the scratch, and a link is a single component that resolves elsewhere.
    #[cfg(unix)]
    #[test]
    fn real_scratch_path_symlink_cannot_escape() {
        let root = unique_root();
        let scratch = unique_root_outside_tmp();
        let outside = unique_root();
        std::os::unix::fs::symlink(&outside, scratch.join("esc")).unwrap();
        let via_link = scratch.join("esc").join("pwned.txt");
        assert_eq!(
            escapes_project(&root, Some(&scratch), via_link.to_str().unwrap()),
            Ok(true),
            "a symlink out of the scratch is an escape"
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// `in_scratch` is lexical and component-wise: a sibling that merely
    /// shares the scratch's name as a prefix is not inside it.
    #[test]
    fn in_scratch_is_component_wise() {
        let scratch = PathBuf::from(if cfg!(windows) {
            r"C:\cache\jan\chat\scratch\s1"
        } else {
            "/cache/jan/chat/scratch/s1"
        });
        let file = scratch.join("out.txt");
        assert!(in_scratch(Some(&scratch), &file));
        assert!(in_scratch(Some(&scratch), &scratch));
        assert!(!in_scratch(Some(&scratch), &scratch.with_file_name("s10").join("x")));
        assert!(!in_scratch(Some(&scratch), Path::new("/elsewhere/out.txt")));
        assert!(!in_scratch(None, &file));
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_caught() {
        let root = unique_root();
        let outside = unique_root();
        std::fs::write(outside.join("secret.txt"), b"x").unwrap();
        let link = root.join("link");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        assert_eq!(escapes_project(&root, None, "link/secret.txt"), Ok(true));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// A dangling link (its target does not exist yet) is still a link: a write
    /// through it creates the target. Resolving only the deepest existing
    /// ancestor and re-appending the rest lexically kept the in-project name,
    /// so `notes.md -> ~/.ssh/authorized_keys` passed as an in-project write.
    #[cfg(unix)]
    #[test]
    fn dangling_symlink_out_of_the_project_escapes() {
        let root = unique_root();
        let outside = unique_root();
        std::os::unix::fs::symlink(outside.join("authorized_keys"), root.join("notes.md"))
            .unwrap();
        // A dangling directory link: the tail hangs off a link that resolves nowhere.
        std::os::unix::fs::symlink(outside.join("no-such-dir"), root.join("d")).unwrap();
        // Relative targets resolve against the link's own directory.
        std::fs::create_dir_all(root.join("sub")).unwrap();
        let rel = Path::new("../..").join(outside.file_name().unwrap()).join("rel.txt");
        std::os::unix::fs::symlink(&rel, root.join("sub/rel.md")).unwrap();

        assert_eq!(escapes_project(&root, None, "notes.md"), Ok(true));
        assert_eq!(escapes_project(&root, None, "d/x.txt"), Ok(true));
        assert_eq!(escapes_project(&root, None, "sub/rel.md"), Ok(true));
        assert_eq!(escapes_project(&root, None, "missing/../notes.md"), Ok(true));
        assert_eq!(escapes_write_roots(&root, None, &[], "notes.md"), Ok(true));
        assert!(symlink_escapes_root(&root, None, &root.join("notes.md")));
        assert!(symlink_escapes_root(&root, None, &root.join("d/x.txt")));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// A dangling link that stays inside the project is an ordinary write.
    #[cfg(unix)]
    #[test]
    fn dangling_symlink_inside_the_project_does_not_escape() {
        let root = unique_root();
        std::fs::create_dir_all(root.join("docs")).unwrap();
        std::os::unix::fs::symlink("docs/README.md", root.join("README.md")).unwrap();
        assert_eq!(escapes_project(&root, None, "README.md"), Ok(false));
        assert!(!symlink_escapes_root(&root, None, &root.join("README.md")));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A link cycle resolves to nothing: fail closed rather than loop.
    #[cfg(unix)]
    #[test]
    fn symlink_cycle_fails_closed() {
        let root = unique_root();
        std::os::unix::fs::symlink("b", root.join("a")).unwrap();
        std::os::unix::fs::symlink("a", root.join("b")).unwrap();
        assert!(escapes_project(&root, None, "a").is_err());
        assert!(symlink_escapes_root(&root, None, &root.join("a")));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The re-check flags only symlinks that *leave* the trusted roots. An
    /// in-root link (the shape every yarn workspace has) resolves back inside
    /// and must stay usable; a link out of the root is an escape; a path that
    /// was never under a root at all is the gate's business, not this check's.
    #[cfg(unix)]
    #[test]
    fn symlink_escape_recheck_allows_in_root_links() {
        let root = unique_root();
        let outside = unique_root();
        std::fs::create_dir_all(root.join("pkg")).unwrap();
        std::fs::write(root.join("pkg/index.js"), b"x").unwrap();
        std::fs::write(outside.join("secret.txt"), b"s").unwrap();

        let inward = root.join("linked");
        std::os::unix::fs::symlink(root.join("pkg"), &inward).unwrap();
        let outward = root.join("escape");
        std::os::unix::fs::symlink(&outside, &outward).unwrap();

        assert!(!symlink_escapes_root(&root, None, &inward.join("index.js")));
        assert!(symlink_escapes_root(
            &root,
            None,
            &outward.join("secret.txt")
        ));
        // A not-yet-existing leaf under a real directory is not an escape.
        assert!(!symlink_escapes_root(
            &root,
            None,
            &root.join("pkg/new.txt")
        ));
        // Outside both roots: the gate already decided, so this check abstains.
        assert!(!symlink_escapes_root(
            &root,
            None,
            &outside.join("secret.txt")
        ));
        // The scratch counts as a trusted root, so a link between the two is in.
        let scratch = unique_root();
        let cross = scratch.join("into-project");
        std::os::unix::fs::symlink(root.join("pkg"), &cross).unwrap();
        assert!(!symlink_escapes_root(
            &root,
            Some(&scratch),
            &cross.join("index.js")
        ));

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    // ---- read-only attached roots -------------------------------------------

    #[test]
    fn a_path_in_a_read_root_is_not_a_read_escape() {
        let ws = unique_root_outside_tmp();
        let repo = unique_root_outside_tmp();
        std::fs::write(repo.join("main.rs"), b"fn main() {}").unwrap();
        let roots = vec![repo.clone()];
        let target = repo.join("main.rs").to_string_lossy().into_owned();

        // Without the root it is an escape; with it, a legitimate read.
        assert!(escapes_project(&ws, None, &target).unwrap());
        assert!(!escapes_read_roots(&ws, None, &roots, &target).unwrap());

        let _ = std::fs::remove_dir_all(&ws);
        let _ = std::fs::remove_dir_all(&repo);
    }

    // The whole point of the mount: reads widen, writes do not. `escapes_project`
    // is what the write path keeps using, so it must still call this an escape.
    #[test]
    fn a_write_into_a_read_root_is_still_an_escape() {
        let ws = unique_root_outside_tmp();
        let repo = unique_root_outside_tmp();
        let target = repo.join("new.txt").to_string_lossy().into_owned();
        assert!(escapes_project(&ws, None, &target).unwrap());
        let _ = std::fs::remove_dir_all(&ws);
        let _ = std::fs::remove_dir_all(&repo);
    }

    #[test]
    fn a_path_outside_every_root_is_still_an_escape() {
        let ws = unique_root_outside_tmp();
        let repo = unique_root_outside_tmp();
        let other = unique_root_outside_tmp();
        let roots = vec![repo.clone()];
        let target = other.join("secret").to_string_lossy().into_owned();
        assert!(escapes_read_roots(&ws, None, &roots, &target).unwrap());
        for d in [&ws, &repo, &other] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    // A read root that vanished must grant nothing, matching the scratch rule.
    #[test]
    fn a_missing_read_root_grants_nothing() {
        let ws = unique_root_outside_tmp();
        let gone = unique_root_outside_tmp();
        let target = gone.join("x").to_string_lossy().into_owned();
        std::fs::remove_dir_all(&gone).unwrap();
        let roots = vec![gone];
        assert!(escapes_read_roots(&ws, None, &roots, &target).unwrap());
        let _ = std::fs::remove_dir_all(&ws);
    }

    // Relative paths belong to the workspace. Resolving them against an attached
    // folder would make `read` and `write` disagree about what one path means.
    #[test]
    fn a_relative_path_still_resolves_against_the_workspace() {
        let ws = unique_root_outside_tmp();
        let repo = unique_root_outside_tmp();
        std::fs::write(repo.join("only-in-repo.txt"), b"x").unwrap();
        let roots = vec![repo.clone()];
        assert!(escapes_read_roots(&ws, None, &roots, "only-in-repo.txt").is_ok());
        let _ = std::fs::remove_dir_all(&ws);
        let _ = std::fs::remove_dir_all(&repo);
    }

    // The hole this mount opens if the read roots are not passed: a link inside
    // the attached folder is not lexically under the workspace, so the plain
    // check returns "already decided" and never looks at where it points.
    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_a_read_root_is_caught() {
        let ws = unique_root_outside_tmp();
        let repo = unique_root_outside_tmp();
        let secret_dir = unique_root_outside_tmp();
        let secret = secret_dir.join("id_rsa");
        std::fs::write(&secret, b"key").unwrap();
        let link = repo.join("innocent.txt");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        let roots = vec![repo.clone()];

        assert!(
            symlink_escapes_any_root(&ws, None, &roots, &link),
            "a link leaving the attached folder must be refused"
        );
        assert!(
            !symlink_escapes_root(&ws, None, &link),
            "and the plain check is exactly why the roots must be passed"
        );
        for d in [&ws, &repo, &secret_dir] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    // A link that stays inside the attached folder is ordinary and must work --
    // every monorepo has them.
    #[cfg(unix)]
    #[test]
    fn a_symlink_inside_a_read_root_is_allowed() {
        let repo = unique_root_outside_tmp();
        let ws = unique_root_outside_tmp();
        let real = repo.join("real.txt");
        std::fs::write(&real, b"x").unwrap();
        let link = repo.join("link.txt");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let roots = vec![repo.clone()];
        assert!(!symlink_escapes_any_root(&ws, None, &roots, &link));
        let _ = std::fs::remove_dir_all(&repo);
        let _ = std::fs::remove_dir_all(&ws);
    }

    /// The home-as-project case from the #9065 review: the Jan home sits inside
    /// the project, and everything under it is hidden, not just config.toml.
    #[test]
    fn the_jan_home_is_hidden_when_the_project_contains_it() {
        let home = unique_root();
        let jan = home.join(".jan");
        std::fs::create_dir_all(jan.join("projects/p-1/memory")).unwrap();
        std::fs::write(jan.join("config.toml"), b"k").unwrap();
        assert!(in_hidden_root(&home, &jan, ".jan/config.toml"));
        assert!(in_hidden_root(&home, &jan, "./.jan/../.jan/config.toml"));
        assert!(in_hidden_root(&home, &jan, jan.join("config.toml").to_str().unwrap()));
        assert!(in_hidden_root(&home, &jan, ".jan"));
        assert!(in_hidden_root(&home, &jan, ".jan/projects/p-1/agent.toml"));
        // Not yet existing files are hidden too, so a write cannot create one.
        assert!(in_hidden_root(&home, &jan, ".jan/hooks.toml"));
        assert!(!in_hidden_root(&home, &jan, "JAN.md"));
        assert!(!in_hidden_root(&home, &jan, ".janitor"));
        let _ = std::fs::remove_dir_all(&home);
    }

    /// A Jan worktree is the agent's own working tree even though it lives
    /// under `~/.jan`; the rest of the home stays hidden from it.
    #[test]
    fn a_worktree_inside_the_jan_home_keeps_its_own_tree() {
        let home = unique_root();
        let jan = home.join(".jan");
        let wt = jan.join("worktrees/repo-1/feature");
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(jan.join("config.toml"), b"k").unwrap();
        assert!(!in_hidden_root(&wt, &jan, "src/main.rs"));
        assert!(!in_hidden_root(&wt, &jan, wt.to_str().unwrap()));
        assert!(in_hidden_root(&wt, &jan, "../../../config.toml"));
        assert!(in_hidden_root(&wt, &jan, jan.join("config.toml").to_str().unwrap()));
        let _ = std::fs::remove_dir_all(&home);
    }

    fn command_touches_hidden_root(project: &Path, hidden: &Path, cmd: &str) -> bool {
        hidden_tokens(hidden, cmd)
            .iter()
            .any(|t| in_hidden_root(project, hidden, t))
    }

    #[test]
    fn command_scan_expands_home_spellings() {
        let home = unique_root();
        let jan = home.join(".jan");
        std::fs::create_dir_all(&jan).unwrap();
        std::fs::write(jan.join("config.toml"), b"k").unwrap();
        let project = home.join("proj");
        std::fs::create_dir_all(&project).unwrap();
        for cmd in [
            "cat ~/.jan/config.toml",
            "cat $HOME/.jan/config.toml",
            "grep key < ${HOME}/.jan/config.toml",
            "cat ../.jan/config.toml",
            "F=~/.jan/config.toml",
        ] {
            assert!(command_touches_hidden_root(&project, &jan, cmd), "{cmd}");
        }
        let abs = format!("cat '{}'", jan.join("config.toml").display());
        assert!(command_touches_hidden_root(&project, &jan, &abs));
        assert!(!command_touches_hidden_root(&project, &jan, "cat ~/.bashrc"));
        assert!(!command_touches_hidden_root(&project, &jan, "ls -la src"));
        let _ = std::fs::remove_dir_all(&home);
    }

    /// A command name without a slash is looked up on `PATH`, never in the
    /// working directory, so it is not a path token; an argument, a path-like
    /// command name, and an assignment's value are.
    #[test]
    fn hidden_tokens_skip_command_names() {
        let jan = Path::new("/h/.jan");
        let tokens = hidden_tokens(
            jan,
            "cd /p && ls -la src | grep x; F=~/.jan/c cat y\n./run.sh z $(dirname \"$PWD\")",
        );
        assert_eq!(
            tokens,
            ["/p", "-la", "src", "x", "/h/.jan/c", "y", "./run.sh", "z", "$", "$PWD"]
        );
        // A shell keyword keeps the next word in command position.
        assert_eq!(hidden_tokens(jan, "if true; then ls; fi"), Vec::<String>::new());
        // A name before `=` with a slash in it is a path, not a variable.
        assert_eq!(hidden_tokens(jan, "cat ~/.jan/a=b"), ["/h/.jan/a", "b"]);
        // Leaving the home names no stray path.
        for command in ["ls", "cd", "cd /abs", "git diff", "if true; then ls; fi"] {
            let tokens = hidden_tokens(jan, command);
            assert!(tokens.iter().all(|t| t == "/abs" || t == "diff"), "{command}: {tokens:?}");
        }
    }

    /// A separator that is quoted, escaped, or part of a redirect, and the end
    /// of a substitution, do not start a command: the word after them is an
    /// argument and still names a path. So do a quoted assignment's value and
    /// a heredoc's body.
    #[test]
    fn hidden_tokens_keep_words_after_quoted_or_closing_separators() {
        let home = unique_root();
        let jan = home.join(".jan");
        std::fs::create_dir_all(&jan).unwrap();
        let project = home.join("proj");
        std::fs::create_dir_all(&project).unwrap();
        for command in [
            "grep -E \"a|b\" .jan",
            "cat 'x;' .jan",
            "tar czf /tmp/k.tgz \"$(true)\" .jan",
            "cd \"$(true)\".jan && cat config.toml",
            "GIT_DIR=\".jan\" git log",
            "ls &>/dev/null .jan",
            "echo \\; .jan",
            "tar czf - -T - <<E\n.jan\nE",
            "tar czf - -T - <<-'E'\n\t.jan\n\tE\nls",
            "tar czf backup-\"$(date +%F)\".tgz .jan",
            "cat `true` .jan",
            "ls >|/dev/null .jan",
            "ls 2>&1 .jan",
            "echo \"`true`\" .jan",
            "x`true` .jan",
            "cat \\.jan",
            "cat \"$HOME/.jan\"",
            "'.jan'",
            "x=(.jan)",
            "cat <<<.jan",
            "echo \"\\\\$(true)\" .jan",
            "true || cat .jan",
            "sh -c 'cat .jan/config.toml'",
        ] {
            let tokens = hidden_tokens(&jan, command);
            assert!(
                tokens.iter().any(|t| in_hidden_root_from(&project, &home, &jan, t)),
                "{command:?}: {tokens:?}"
            );
        }
        // After the heredoc's end the next line is a command again.
        assert_eq!(hidden_tokens(&jan, "cat <<E\nx y\nE\nls"), ["E", "x", "y"]);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn hidden_under_spells_the_home_the_way_a_walk_does() {
        let home = unique_root();
        let jan = home.join(".jan");
        std::fs::create_dir_all(&jan).unwrap();
        assert_eq!(hidden_under(&home, &jan), Some(home.join(".jan")));
        let dot = home.join(".");
        assert_eq!(hidden_under(&dot, &jan), Some(dot.join(".jan")));
        let other = home.join("proj");
        std::fs::create_dir_all(&other).unwrap();
        assert_eq!(hidden_under(&other, &jan), None);
        let _ = std::fs::remove_dir_all(&home);
    }
}
