"""Install downloaded SDK artifacts and drive their real runtime, without source imports."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import unquote
from urllib.request import urlopen


class Provider(BaseHTTPRequestHandler):
    tool_results = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        results = [m for m in body["messages"] if m["role"] == "tool"]
        if results:
            self.tool_results.append(results[-1]["content"])
            delta = {"role": "assistant", "content": "The sensor is 42."}
            finish = "stop"
        else:
            delta = {"role": "assistant", "tool_calls": [{
                "index": 0, "id": "sensor-1", "type": "function",
                "function": {"name": "host__measure", "arguments": "{}"},
            }]}
            finish = "tool_calls"
        chunks = []
        for data, reason in [(delta, None), ({}, finish)]:
            chunks.append("data: " + json.dumps({
                "id": "smoke", "object": "chat.completion.chunk", "created": 1,
                "model": "stub-model", "choices": [{"index": 0, "delta": data, "finish_reason": reason}],
            }) + "\n\n")
        payload = ("".join(chunks) + "data: [DONE]\n\n").encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def download(url):
    with urlopen(url, timeout=120) as response:
        return response.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", help="Public URL or local manifest path (PR verification)")
    parser.add_argument("--artifacts", type=Path, help="PR-only local artifact directory")
    args = parser.parse_args()
    manifest = json.loads(args.artifacts.joinpath("manifest.json").read_text() if args.artifacts else download(args.manifest))
    node, npm = shutil.which("node"), shutil.which("npm")
    assert node and npm, "Node/npm required for the JS smoke"
    scripts = Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory(prefix="jan-sdk-artifact-") as directory:
        root = Path(directory)
        artifacts = {}
        for language in ["javascript", "python"]:
            entry = manifest["packages"][language]
            name = unquote(entry["url"].rsplit("/", 1)[1])
            data = args.artifacts.joinpath(name).read_bytes() if args.artifacts else download(entry["url"])
            assert hashlib.sha256(data).hexdigest() == entry["sha256"], f"{language} digest mismatch"
            artifacts[language] = root / name
            artifacts[language].write_bytes(data)
        snapshot = args.artifacts.joinpath("runtime.json").read_bytes() if args.artifacts else download(manifest["runtime"]["manifestUrl"])
        assert hashlib.sha256(snapshot).hexdigest() == manifest["runtime"]["sha256"], "runtime manifest digest mismatch"
        # A private HTTP endpoint makes the same immutable snapshot usable by both installers in PRs.
        class RuntimeManifest(BaseHTTPRequestHandler):
            def log_message(self, *unused):
                pass

            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Length", str(len(snapshot)))
                self.end_headers()
                self.wfile.write(snapshot)

        runtime_server = ThreadingHTTPServer(("127.0.0.1", 0), RuntimeManifest)
        provider = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
        threads = [Thread(target=s.serve_forever, daemon=True) for s in (runtime_server, provider)]
        for thread in threads:
            thread.start()
        try:
            env = {k: v for k, v in os.environ.items() if not k.startswith(("JAN_", "PYTHON"))}
            home = root / "home"
            home.mkdir()
            env.update(HOME=str(home), USERPROFILE=str(home), JAN_AGENT_HOME=str(root / "runtimes"),
                       JAN_CLI_NO_UPDATE_CHECK="1", RUNTIME_VERSION=manifest["runtime"]["version"],
                       RUNTIME_MANIFEST=f"http://127.0.0.1:{runtime_server.server_port}/runtime.json",
                       PROVIDER_URL=f"http://127.0.0.1:{provider.server_port}/v1")
            js = root / "js"
            js.mkdir()
            (js / "package.json").write_text('{"private":true,"type":"module"}')
            # .cmd launchers need cmd.exe on Windows; arguments are generated local paths only.
            subprocess.run([npm, "install", "--ignore-scripts", "--no-audit", "--no-fund", str(artifacts["javascript"])],
                           cwd=js, env=env, check=True, timeout=120, shell=os.name == "nt")
            shutil.copyfile(scripts / "smoke.mjs", js / "smoke.mjs")
            subprocess.run([node, "smoke.mjs"], cwd=js, env=env, check=True, timeout=180)
            venv = root / "venv"
            subprocess.run([sys.executable, "-m", "venv", str(venv)], check=True, timeout=120)
            python = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            subprocess.run([str(python), "-m", "pip", "install", "--no-deps", str(artifacts["python"])],
                           cwd=root, env=env, check=True, timeout=120)
            shutil.copyfile(scripts / "smoke_client.py", root / "smoke_client.py")
            # Keep Windows DLL utilities available but remove every Node search path.
            env["PATH"] = str(python.parent) + (os.pathsep + str(Path(os.environ["SystemRoot"]) / "System32") if os.name == "nt" else ":/usr/bin:/bin")
            # Some Linux images put Node in /usr/bin; Python and the installed runtime need no PATH executables.
            if os.name != "nt":
                env["PATH"] = str(python.parent)
            subprocess.run([str(python), "smoke_client.py"], cwd=root, env=env, check=True, timeout=180)
            assert Provider.tool_results == ["sensor=42", "sensor=42"], Provider.tool_results
            print("Both installed artifacts delivered their host result to the provider.")
        finally:
            for server in (runtime_server, provider):
                server.shutdown()
                server.server_close()
            for thread in threads:
                thread.join()


if __name__ == "__main__":
    main()
