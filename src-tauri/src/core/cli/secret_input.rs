//! Masked secret entry shared by the two places that collect an API key: the
//! plain-terminal prompt in [`super::login`] and the TUI's `/login` overlay.
//!
//! The value is never echoed verbatim; callers render [`mask`] instead, so the
//! user gets proof that a keystroke or paste landed without the key reaching the
//! screen or the scrollback.

use std::io::Write;

use ratatui::crossterm::{
    event::{
        self, DisableBracketedPaste, EnableBracketedPaste, Event, KeyCode, KeyEventKind,
        KeyModifiers,
    },
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, Clear, ClearType},
};

/// Longest run of mask characters rendered. Bounds the field so a long paste
/// cannot overflow a TUI box or wrap a terminal line, and hides the key's exact
/// length from anyone reading over a shoulder.
const MASK_MAX: usize = 32;

/// Bounded stand-in for a secret of `char_count` characters.
pub fn mask(char_count: usize) -> String {
    "*".repeat(char_count.min(MASK_MAX))
}

/// Plain text from the OS clipboard, for the Ctrl-V fallback below.
pub fn clipboard_text() -> Result<String, String> {
    arboard::Clipboard::new()
        .and_then(|mut clip| clip.get_text())
        .map_err(|e| e.to_string())
}

/// Whitespace terminals add around a paste is dropped; interior whitespace is
/// kept so `sanitize_key` can reject a mis-paste with a clear reason rather than
/// silently mangling the key.
pub fn pasted(text: &str) -> &str {
    text.trim()
}

/// What one input event does to a secret field.
#[derive(Debug, PartialEq, Eq)]
pub enum Action {
    Insert(String),
    Backspace,
    Clear,
    /// Ctrl-V arrived as a keystroke: read the clipboard ourselves.
    PasteClipboard,
    Submit,
    Cancel,
    Ignore,
}

/// Map a terminal event onto a field edit. Pure, so the key semantics both
/// front-ends rely on are testable without a terminal.
pub fn classify(event: &Event) -> Action {
    let key = match event {
        Event::Paste(text) => return Action::Insert(pasted(text).to_string()),
        Event::Key(key) if key.kind == KeyEventKind::Press => key,
        _ => return Action::Ignore,
    };
    let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
    match key.code {
        KeyCode::Esc => Action::Cancel,
        KeyCode::Char('c' | 'd') if ctrl => Action::Cancel,
        KeyCode::Char('u') if ctrl => Action::Clear,
        KeyCode::Char('v') if ctrl => Action::PasteClipboard,
        KeyCode::Enter => Action::Submit,
        // Raw mode maps only CR to Enter; a bare LF reaches us as Ctrl-J, which
        // is how a redirected or line-translating tty delivers a submit.
        KeyCode::Char('j') if ctrl => Action::Submit,
        KeyCode::Backspace => Action::Backspace,
        KeyCode::Char(ch) if !ctrl => Action::Insert(ch.to_string()),
        _ => Action::Ignore,
    }
}

/// Restore the terminal on every exit path, including a panic mid-prompt.
struct RawGuard;

impl Drop for RawGuard {
    fn drop(&mut self) {
        let _ = execute!(std::io::stdout(), DisableBracketedPaste);
        let _ = disable_raw_mode();
    }
}

/// Read a secret from the terminal, echoing [`mask`] as it is typed or pasted.
/// `None` means the user cancelled (Esc, Ctrl-C, or Ctrl-D).
///
/// Raw mode is entered once for the whole read rather than per keystroke: a
/// paste arriving while the terminal was briefly back in canonical mode would be
/// echoed in plaintext by the tty driver.
pub fn read_masked_line(prompt: &str) -> Result<Option<String>, String> {
    let mut out = std::io::stdout();
    enable_raw_mode().map_err(|e| format!("could not read the API key: {e}"))?;
    let _guard = RawGuard;
    // Bracketed paste turns a paste into one event instead of a burst of
    // keystrokes, so a key with interior whitespace survives intact.
    let _ = execute!(out, EnableBracketedPaste);

    let mut input = String::new();
    let mut error: Option<String> = None;
    loop {
        redraw(&mut out, prompt, input.chars().count(), error.as_deref())
            .map_err(|e| format!("could not draw the API key prompt: {e}"))?;
        let event = event::read().map_err(|e| format!("could not read the API key: {e}"))?;
        error = None;
        match classify(&event) {
            Action::Insert(text) => input.push_str(&text),
            Action::Backspace => {
                input.pop();
            }
            Action::Clear => input.clear(),
            Action::PasteClipboard => match clipboard_text() {
                Ok(text) => input.push_str(pasted(&text)),
                Err(e) => error = Some(format!("could not read the clipboard: {e}")),
            },
            Action::Submit => {
                let _ = write!(out, "\r\n");
                let _ = out.flush();
                return Ok(Some(input));
            }
            Action::Cancel => {
                let _ = write!(out, "\r\n");
                let _ = out.flush();
                return Ok(None);
            }
            Action::Ignore => {}
        }
    }
}

fn redraw(
    out: &mut std::io::Stdout,
    prompt: &str,
    char_count: usize,
    error: Option<&str>,
) -> std::io::Result<()> {
    execute!(out, Clear(ClearType::CurrentLine))?;
    write!(out, "\r{prompt}{}", mask(char_count))?;
    if let Some(error) = error {
        write!(out, "  ({error})")?;
    }
    out.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::crossterm::event::KeyEvent;

    fn key(code: KeyCode) -> Event {
        Event::Key(KeyEvent::new(code, KeyModifiers::NONE))
    }

    fn ctrl(ch: char) -> Event {
        Event::Key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::CONTROL))
    }

    #[test]
    fn mask_is_one_star_per_char_up_to_the_cap() {
        assert_eq!(mask(0), "");
        assert_eq!(mask(9), "*********");
        assert_eq!(mask(MASK_MAX).chars().count(), MASK_MAX);
        // A long key must not leak its length or overflow the field.
        assert_eq!(mask(4096).chars().count(), MASK_MAX);
    }

    #[test]
    fn typing_and_pasting_both_reach_the_field() {
        assert_eq!(
            classify(&key(KeyCode::Char('a'))),
            Action::Insert("a".into())
        );
        assert_eq!(
            classify(&Event::Paste("  sk-abc \n".into())),
            Action::Insert("sk-abc".into())
        );
    }

    #[test]
    fn interior_whitespace_survives_a_paste_so_it_can_be_rejected() {
        assert_eq!(pasted(" sk-a b \n"), "sk-a b");
    }

    #[test]
    fn every_way_out_of_the_prompt_is_honoured() {
        assert_eq!(classify(&key(KeyCode::Enter)), Action::Submit);
        // Raw mode delivers a bare LF as Ctrl-J rather than Enter.
        assert_eq!(classify(&ctrl('j')), Action::Submit);
        assert_eq!(classify(&key(KeyCode::Esc)), Action::Cancel);
        assert_eq!(classify(&ctrl('c')), Action::Cancel);
        assert_eq!(classify(&ctrl('d')), Action::Cancel);
    }

    #[test]
    fn editing_keys_match_the_tui_overlay() {
        assert_eq!(classify(&key(KeyCode::Backspace)), Action::Backspace);
        assert_eq!(classify(&ctrl('u')), Action::Clear);
        assert_eq!(classify(&ctrl('v')), Action::PasteClipboard);
    }

    #[test]
    fn control_chords_never_land_in_the_key() {
        // A stray Ctrl-<x> must not become a character in the secret.
        for ch in ['a', 'z', 'w'] {
            assert_eq!(classify(&ctrl(ch)), Action::Ignore);
        }
    }

    #[test]
    fn non_press_and_navigation_events_are_ignored() {
        let release = Event::Key(KeyEvent::new_with_kind(
            KeyCode::Char('a'),
            KeyModifiers::NONE,
            KeyEventKind::Release,
        ));
        assert_eq!(classify(&release), Action::Ignore);
        assert_eq!(classify(&key(KeyCode::Left)), Action::Ignore);
        assert_eq!(classify(&Event::FocusGained), Action::Ignore);
    }
}
