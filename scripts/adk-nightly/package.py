"""Build versioned ADK artifacts and snapshot their compatible runtime manifest.

Only the workflow promotes manifest.json, after all platform smoke jobs succeed.
The output directory must be new: a release identity is never repackaged in place.
"""
import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
from urllib.parse import quote
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
PLATFORMS = ["linux-x86_64", "linux-aarch64", "darwin-universal", "windows-x86_64"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--build", required=True, help="GitHub run ID and attempt, e.g. 123456.1")
    parser.add_argument("--sha", required=True)
    parser.add_argument("--base-url", default="https://delta.jan.ai/adk-nightly")
    parser.add_argument("--runtime-manifest", default="https://delta.jan.ai/agent-nightly/manifest.json")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9]+\.[0-9]+", args.build) or not re.fullmatch(r"[0-9a-f]{40}", args.sha):
        parser.error("build must be run.attempt and sha must be a full lowercase commit SHA")
    identity = f"{args.sha}-{args.build}"
    base_url = f"{args.base_url.rstrip('/')}/{identity}"
    with urlopen(args.runtime_manifest, timeout=60) as response:
        snapshot = response.read()
    runtime = json.loads(snapshot)
    for platform in PLATFORMS:
        entry = runtime["platforms"][platform]
        if not entry["url"].startswith("https://") or not re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]):
            raise ValueError(f"Invalid published runtime for {platform}")
    if not runtime["version"]:
        raise ValueError("Missing runtime version")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    manifest = {
        "schemaVersion": 1, "channel": "nightly", "build": identity, "sourceRevision": args.sha,
        "protocolVersion": json.loads((ROOT / "protocol/rpc-schema.json").read_text())["protocol_version"],
        "platforms": PLATFORMS,
        "runtime": {"channel": "agent-nightly", "version": runtime["version"],
                    "manifestUrl": f"{base_url}/runtime.json", "sha256": hashlib.sha256(snapshot).hexdigest()},
        "packages": {},
    }
    (output / "runtime.json").write_bytes(snapshot)
    with tempfile.TemporaryDirectory(prefix="jan-adk-package-") as temporary:
        stage = Path(temporary)
        js = stage / "javascript"
        shutil.copytree(ROOT / "packages/adk", js, ignore=shutil.ignore_patterns("node_modules"))
        package = json.loads((js / "package.json").read_text())
        package["version"] = f'{package["version"].split("-")[0]}-nightly.{args.build}'
        (js / "package.json").write_text(json.dumps(package, indent=2) + "\n")
        subprocess.run(["npm", "pack", "--ignore-scripts", "--pack-destination", str(output)], cwd=js, check=True)
        archive = next(output.glob("*.tgz"))
        manifest["packages"]["javascript"] = {"name": package["name"], "version": package["version"],
            "url": f"{base_url}/{archive.name}", "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}
        py = stage / "python"
        shutil.copytree(ROOT / "adk/python", py, ignore=shutil.ignore_patterns("__pycache__", "*.egg-info", "build", "dist"))
        metadata_path = py / "pyproject.toml"
        metadata = metadata_path.read_text()
        project = tomllib.loads(metadata)["project"]
        run, attempt = args.build.split(".")
        version = f'{project["version"]}.dev{run}+g{args.sha[:12]}.{attempt}'
        metadata_path.write_text(metadata.replace(f'version = "{project["version"]}"', f'version = "{version}"', 1))
        subprocess.run([sys.executable, "-m", "build", "--wheel", "--outdir", str(output), str(py)], check=True)
        wheel = next(output.glob("*.whl"))
        manifest["packages"]["python"] = {"name": project["name"], "version": version,
            "url": f"{base_url}/{quote(wheel.name, safe='')}", "sha256": hashlib.sha256(wheel.read_bytes()).hexdigest()}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    js_package = manifest["packages"]["javascript"]
    py_package = manifest["packages"]["python"]
    wheel_url = f'{py_package["url"]}#sha256={py_package["sha256"]}'
    # Also a pip --find-links index. Every link points to one immutable build.
    page = f"""<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Jan ADK nightly</title>
<style>body{{max-width:72ch;margin:3rem auto;padding:0 1rem;font:17px/1.6 system-ui;overflow-wrap:anywhere}}pre{{overflow:auto;background:#eee;padding:1rem}}code{{font-size:14px}}</style>
<h1>Jan ADK nightly</h1>
<p>Preview build <code>{html.escape(identity)}</code>. No registry publication,
repository checkout, Jan Desktop or Rust compiler required.</p>
<h2>JavaScript (Node.js 20+)</h2>
<pre>npm install {html.escape(js_package["url"])}</pre>
<h2>Python (3.11+, no Node required)</h2>
<p>Use a virtual environment, then:</p>
<pre>python -m pip install "{html.escape(wheel_url)}"</pre>
<p><a href="{html.escape(wheel_url)}">Download Python wheel</a></p>
<h2>Matching runtime</h2>
<p>Package installation does not download or launch a runtime. Explicitly call
<code>installRuntime</code> / <code>install_runtime</code> with version
<code>{html.escape(runtime["version"])}</code> and manifest URL
<a href="{base_url}/runtime.json">{base_url}/runtime.json</a>.
Pass the returned <code>bin</code> to <code>JanRuntime.start</code>.
An existing compatible binary can also be passed explicitly.</p>
<p><a href="{base_url}/manifest.json">Versioned manifest and SHA-256 digests</a> |
<a href="https://jan.ai/docs/agent/adk">ADK guides</a></p>
<p>Supported: Linux x64/ARM64, macOS Intel/Apple Silicon, Windows x64.
Windows ARM64 is not declared supported by this nightly smoke matrix.</p>
<p>Save this versioned page for repeatable installation. Versioned artifacts are not
overwritten or automatically deleted by the workflow. Missing versions fail;
they are never silently substituted with latest. These are previews, not stable releases.</p>
</html>
"""
    (output / "index.html").write_text(page)
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
