//! Ctrl-Z in the TUI (and an external SIGTSTP) must hand a real terminal back
//! clean before the process stops, and take it back on SIGCONT: raw mode,
//! alternate screen, mouse tracking and the Kitty keyboard protocol off while
//! stopped, all back on after. Spawns the real `jan` binary under a PTY the
//! same way `tui_panic.rs` does, and watches the stop with `waitpid`.
//!
//! unix-only: job control is a POSIX concept, and the suspend is compiled out
//! elsewhere.
#![cfg(unix)]

use std::fs::File;
use std::io::{Read, Write};
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use nix::pty::{openpty, Winsize};
use nix::sys::signal::{kill, Signal};
use nix::sys::termios::{tcgetattr, LocalFlags};
use nix::sys::wait::{waitpid, WaitPidFlag, WaitStatus};
use nix::unistd::Pid;

/// Generous for a debug build on a loaded CI runner.
const DEADLINE: Duration = Duration::from_secs(60);

const ENTER: [&str; 4] = ["\x1b[?1049h", "\x1b[?2004h", "\x1b[>5u", "\x1b[?1000h"];
const LEAVE: [&str; 5] = [
    "\x1b[?1049l",
    "\x1b[?2004l",
    "\x1b[<u",
    "\x1b[?1000l",
    "\x1b[?25h",
];

struct Session {
    child: Child,
    pid: Pid,
    master: File,
    output: Arc<Mutex<Vec<u8>>>,
    home: std::path::PathBuf,
}

impl Session {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.output.lock().unwrap()).into_owned()
    }

    /// Wait until every `seqs` entry appears in the output past `from`.
    fn wait_for(&self, from: usize, seqs: &[&str], what: &str) {
        let deadline = Instant::now() + DEADLINE;
        loop {
            let text = self.text();
            let tail = text.get(from..).unwrap_or("");
            if seqs.iter().all(|s| tail.contains(s)) {
                return;
            }
            assert!(Instant::now() < deadline, "timed out waiting for {what}: {text:?}");
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn wait_stopped(&self) {
        let deadline = Instant::now() + DEADLINE;
        loop {
            let flags = WaitPidFlag::WUNTRACED | WaitPidFlag::WNOHANG;
            match waitpid(self.pid, Some(flags)).expect("waitpid") {
                WaitStatus::Stopped(..) => return,
                WaitStatus::StillAlive => {}
                other => panic!("jan did not stop: {other:?}: {:?}", self.text()),
            }
            assert!(Instant::now() < deadline, "jan never stopped: {:?}", self.text());
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn alive(&self) -> bool {
        let flags = WaitPidFlag::WNOHANG;
        matches!(waitpid(self.pid, Some(flags)), Ok(WaitStatus::StillAlive))
    }

    fn raw(&self) -> bool {
        let termios = tcgetattr(&self.master).expect("read PTY termios");
        !termios
            .local_flags
            .intersects(LocalFlags::ICANON | LocalFlags::ECHO)
    }

    /// Stop by `stop`, check the terminal is clean while stopped, resume, and
    /// check the modes and raw mode come back.
    fn cycle(&self, stop: impl FnOnce(), what: &str) {
        let before = self.text().len();
        stop();
        self.wait_stopped();
        self.wait_for(before, &LEAVE, &format!("{what}: modes restored before stopping"));
        assert!(!self.raw(), "{what}: the shell got a raw-mode terminal");
        let stopped_at = self.text().len();
        kill(self.pid, Signal::SIGCONT).expect("SIGCONT");
        self.wait_for(stopped_at, &ENTER, &format!("{what}: modes re-entered on resume"));
        let deadline = Instant::now() + DEADLINE;
        while !self.raw() {
            assert!(Instant::now() < deadline, "{what}: raw mode not re-enabled");
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

fn spawn() -> Session {
    spawn_with(false)
}

/// `new_session` runs `jan` through `setsid --ctty`, so it leads a session of
/// its own and its parent (this runner) is in another one: an orphaned process
/// group, like `ssh -t host jan` or `docker exec -it`.
fn spawn_with(new_session: bool) -> Session {
    let size = Winsize {
        ws_row: 24,
        ws_col: 80,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    let pty = openpty(&size, None).expect("open test PTY");
    let mut reader = File::from(pty.master);
    let master = reader.try_clone().expect("clone PTY master");
    let slave = File::from(pty.slave);
    let home = std::env::temp_dir().join(format!("jan-tui-suspend-{}", std::process::id()));
    std::fs::create_dir_all(&home).unwrap();
    let mut command = if new_session {
        let mut c = Command::new("setsid");
        c.arg("--ctty").arg(env!("CARGO_BIN_EXE_jan"));
        c
    } else {
        Command::new(env!("CARGO_BIN_EXE_jan"))
    };
    if !new_session {
        // The suspend stops jan's whole process group; without a group of its
        // own that would be this test runner's.
        command.process_group(0);
    }
    let child = command
        .env("HOME", &home)
        .env("JAN_CLI_NO_UPDATE_CHECK", "1")
        .stdin(Stdio::from(slave.try_clone().expect("clone PTY slave")))
        .stdout(Stdio::from(slave.try_clone().expect("clone PTY slave")))
        .stderr(Stdio::from(slave))
        .spawn()
        .expect("spawn jan under the test PTY");
    let pid = Pid::from_raw(child.id() as i32);
    let output = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&output);
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        // Ends with EIO once the child is gone and the last slave closes.
        while let Ok(n) = reader.read(&mut buffer) {
            if n == 0 {
                break;
            }
            sink.lock().unwrap().extend_from_slice(&buffer[..n]);
        }
    });
    Session {
        child,
        pid,
        master,
        output,
        home,
    }
}

#[test]
fn ctrl_z_and_sigtstp_suspend_and_resume_cleanly() {
    let session = spawn();
    session.wait_for(0, &ENTER, "the TUI to start");
    assert!(session.raw(), "the TUI runs in raw mode");

    let mut master = session.master.try_clone().expect("clone PTY master");
    session.cycle(
        || {
            // Ctrl-Z, as a raw-mode terminal delivers it: a plain 0x1a byte.
            master.write_all(b"\x1a").expect("type Ctrl-Z");
        },
        "Ctrl-Z",
    );
    session.cycle(
        || kill(session.pid, Signal::SIGTSTP).expect("SIGTSTP"),
        "external SIGTSTP",
    );
    assert!(session.alive(), "jan exited after resuming: {:?}", session.text());
}

/// With no job-control shell above it nothing would ever send SIGCONT, so
/// Ctrl-Z must refuse (and say so) rather than stop and hang the terminal.
#[test]
fn ctrl_z_in_an_orphaned_group_refuses_instead_of_stopping() {
    let session = spawn_with(true);
    session.wait_for(0, &ENTER, "the TUI to start");
    let mut master = session.master.try_clone().expect("clone PTY master");
    let before = session.text().len();
    master.write_all(b"\x1a").expect("type Ctrl-Z");
    let deadline = Instant::now() + DEADLINE;
    while !session.text()[before..].contains("could not suspend") {
        assert!(Instant::now() < deadline, "no refusal: {:?}", session.text());
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(session.alive(), "jan stopped or exited: {:?}", session.text());
    assert!(session.raw(), "the TUI kept the terminal");
}
