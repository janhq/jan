use std::{env, process::Stdio, time::Duration};

use rmcp::{transport::TokioChildProcess, ServiceExt};
use tokio::{io::AsyncReadExt, process::Command, time::sleep};

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("usage: rmcp-probe <command> [args...]");
        std::process::exit(64);
    }
    let cmd_name = args[0].clone();
    let cmd_args = &args[1..];

    let mut cmd = Command::new(&cmd_name);
    for a in cmd_args {
        cmd.arg(a);
    }
    cmd.kill_on_drop(true);

    println!("[probe] spawning {cmd_name} {:?}", cmd_args);
    let (process, stderr) = TokioChildProcess::builder(cmd)
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn");

    let pid = process.id();
    println!("[probe] spawned pid={:?}", pid);

    let service = ().serve(process).await;
    let service = match service {
        Ok(s) => {
            println!("[probe] handshake OK, peer_info={:?}", s.peer_info().map(|i| &i.server_info.name));
            s
        }
        Err(e) => {
            eprintln!("[probe] handshake FAILED: {e}");
            if let Some(mut s) = stderr {
                let mut buf = String::new();
                let _ = s.read_to_string(&mut buf).await;
                eprintln!("[probe] stderr:\n{buf}");
            }
            std::process::exit(1);
        }
    };

    // *** This is the suspect: drop stderr explicitly ***
    println!("[probe] DROPPING stderr handle (simulates schedule_mcp_start_task)");
    drop(stderr);

    for i in 0..10 {
        sleep(Duration::from_secs(1)).await;
        let r = tokio::time::timeout(Duration::from_secs(5), service.list_all_tools()).await;
        match r {
            Ok(Ok(tools)) => {
                println!(
                    "[probe] t={}s: list_all_tools OK ({} tools)",
                    i + 1,
                    tools.len()
                );
            }
            Ok(Err(e)) => {
                eprintln!("[probe] t={}s: list_all_tools ERR: {e}", i + 1);
                break;
            }
            Err(_) => {
                eprintln!("[probe] t={}s: list_all_tools TIMEOUT (5s)", i + 1);
                break;
            }
        }
    }

    println!("[probe] cancelling service");
    let _ = service.cancel().await;
    println!("[probe] done");
}
