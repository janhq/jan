//! A panic inside the TUI (`JAN_TUI_PANIC_AFTER_RAW_MODE`, see
//! `core::cli::tui::run`) must leave a real terminal clean: no raw mode, no
//! alternate screen, no mouse tracking, no Kitty keyboard protocol, cursor
//! visible. An in-memory `TestBackend` cannot show this -- there is no real
//! terminal underneath it, so nothing proves the escape sequences the panic
//! hook emits ever reach a tty. This spawns the real `jan` binary under a
//! real PTY (`nix::pty::openpty`) and reads back the raw bytes the binary wrote.
//!
//! unix-only: the panic hook and its terminal-mode sequences are written for
//! an ANSI terminal; `openpty` itself is a POSIX API.
#![cfg(unix)]

use std::fs::File;
use std::io::Read;
use std::process::{Command, Stdio};

use nix::pty::{openpty, Winsize};
use nix::sys::termios::{tcgetattr, LocalFlags};

/// A scratch `HOME` of our own, so the binary's "not signed in" first-run path
/// runs (no provider configured, no network, no credentials) rather than
/// touching a real `~/.jan`.
fn scratch_home() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("jan-tui-panic-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn panic_after_raw_mode_leaves_the_terminal_clean() {
    let size = Winsize {
        ws_row: 24,
        ws_col: 80,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    // nix's safe wrapper hands back two `OwnedFd`s, so no raw-fd ownership
    // transfer (and no `unsafe`) is needed here.
    let pty = openpty(&size, None).expect("open test PTY");
    let mut master = File::from(pty.master);
    let slave = File::from(pty.slave);
    // Raw mode is termios state, not an escape sequence, so it never shows up
    // in the captured bytes. A master-side `tcgetattr` reads the line
    // discipline the slave shares, and works after the child has exited and
    // closed the last slave fd (keeping a slave clone instead would block the
    // reader below forever, since EIO only arrives once every slave is gone).
    let termios_probe = master.try_clone().expect("clone PTY master");

    let home = scratch_home();
    let child = Command::new(env!("CARGO_BIN_EXE_jan"))
        .env("HOME", &home)
        .env("JAN_CLI_NO_UPDATE_CHECK", "1")
        .env("JAN_TUI_PANIC_AFTER_RAW_MODE", "1")
        // RUST_BACKTRACE off: the panic hook's output is what is under test,
        // not the backtrace, and a backtrace could itself contain bytes that
        // confuse the escape-sequence assertions below.
        .env("RUST_BACKTRACE", "0")
        .stdin(Stdio::from(slave.try_clone().expect("clone PTY slave")))
        .stdout(Stdio::from(slave.try_clone().expect("clone PTY slave")))
        .stderr(Stdio::from(slave))
        .spawn()
        .expect("spawn jan under the test PTY");

    let reader = std::thread::spawn(move || {
        let mut output = Vec::new();
        let mut buffer = [0u8; 4096];
        loop {
            match master.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => output.extend_from_slice(&buffer[..n]),
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                // Linux reports EIO once the last PTY slave closes.
                Err(e) if e.raw_os_error() == Some(nix::libc::EIO) => break,
                Err(e) => panic!("read child PTY: {e}"),
            }
        }
        output
    });

    let status = child
        .wait_with_output()
        .expect("wait for the panicking jan process");
    let output = reader.join().expect("read terminal output");
    let text = String::from_utf8_lossy(&output);

    let _ = std::fs::remove_dir_all(&home);

    // `install_panic_hook` runs `restore_terminal_modes` before unwinding
    // continues, so the process exits with a panic (non-zero), not a clean 0 --
    // the thing under test is what reached the terminal before that exit, not
    // the exit code itself, but a successful exit would mean the panic never
    // fired and the test is not exercising anything.
    assert!(
        !status.status.success(),
        "the induced panic did not abort the process; stderr/stdout: {text}"
    );

    // `disable_raw_mode` restores the termios crossterm saved at
    // `enable_raw_mode`: canonical line editing and echo back on.
    let termios = tcgetattr(&termios_probe).expect("read PTY termios");
    assert!(
        termios
            .local_flags
            .contains(LocalFlags::ICANON | LocalFlags::ECHO),
        "the panic hook left the terminal in raw mode: {:?}",
        termios.local_flags
    );

    // Private modes `startup_modes`/`restore_terminal_modes` toggle, in the
    // order the panic hook writes them: bracketed paste, mouse tracking (SGR +
    // drag + buttons), alternate scroll's own save/restore pair, the alternate
    // screen buffer, and the Kitty keyboard protocol push/pop.
    let enabled = [
        ("bracketed paste enabled", "\x1b[?2004h"),
        ("mouse buttons+wheel enabled", "\x1b[?1000h"),
        ("mouse drag enabled", "\x1b[?1002h"),
        ("SGR mouse coordinates enabled", "\x1b[?1006h"),
        ("alternate screen entered", "\x1b[?1049h"),
        ("Kitty keyboard protocol pushed", "\x1b[>5u"),
    ];
    for (label, seq) in enabled {
        assert!(
            text.contains(seq),
            "expected the session to have turned {label} on ({seq:?}) before panicking: {text}"
        );
    }

    let restored = [
        ("bracketed paste disabled", "\x1b[?2004l"),
        ("mouse buttons+wheel disabled", "\x1b[?1000l"),
        ("mouse drag disabled", "\x1b[?1002l"),
        ("SGR mouse coordinates disabled", "\x1b[?1006l"),
        ("alternate screen left", "\x1b[?1049l"),
        ("Kitty keyboard protocol popped", "\x1b[<u"),
        ("cursor shown", "\x1b[?25h"),
    ];
    for (label, seq) in restored {
        assert!(
            text.contains(seq),
            "expected the panic hook to have {label} ({seq:?}): {text}"
        );
    }

    // Order matters as much as presence: every disable sequence must appear
    // after the panic was induced (i.e. after Kitty keys were turned on, the
    // last mode `run` enables before the test's panic trigger), proving the
    // hook -- not some earlier/unrelated code path -- is what restored them.
    let kitty_on_at = text.find("\x1b[>5u").expect("kitty on");
    let kitty_off_at = text.rfind("\x1b[<u").expect("kitty off");
    assert!(
        kitty_off_at > kitty_on_at,
        "the restore sequence must follow the panic trigger: {text}"
    );
    let alt_screen_leave_at = text.rfind("\x1b[?1049l").expect("alt screen left");
    assert!(
        alt_screen_leave_at > kitty_on_at,
        "leaving the alternate screen must follow the panic trigger too: {text}"
    );
}
