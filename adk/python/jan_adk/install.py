"""Installing a pinned Jan runtime, without a Rust toolchain and without Jan Desktop.

:class:`JanRuntime` spawns and owns a ``jan`` process, and where that process
comes from is the caller's business: a PATH install, a build of their own, or
this - the runtime Jan publishes, downloaded for this platform and checked
against the digest the manifest carries.

The manifest is the only source of truth, deliberately. It names, per platform,
the artifact and its SHA-256; an install therefore reproduces the bytes that were
advertised rather than whatever the URL serves today. A caller who names a
``version`` or a ``sha256`` is pinning: the install fails closed when the
published manifest has moved on, which is the same rule the protocol applies to a
session's model.

An install is atomic: everything happens in a staging directory that is renamed
into place only after the digest matches and the binary is there, so an
interrupted or corrupt install never leaves something that looks usable. Nothing
here needs Node or a third-party package.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform as _platform
import re
import tempfile
import shutil
import tarfile
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, Optional, Tuple
from urllib.parse import urlparse
from urllib.request import Request, urlopen

# The channel the runtime is published on today. A release channel is the same
# shape at another URL, which is why the URL is an argument and this is only a
# default.
MANIFEST_URL = "https://delta.jan.ai/agent-nightly/manifest.json"

# Every platform key the current manifest publishes. macOS is one universal
# artifact, so both of its architectures map to ``darwin-universal``.
PLATFORM_KEYS: Tuple[str, ...] = (
    "darwin-universal",
    "linux-x86_64",
    "linux-aarch64",
    "windows-x86_64",
    "windows-aarch64",
)

ARCH_ALIASES = {
    "x86_64": "x86_64",
    "amd64": "x86_64",
    "arm64": "aarch64",
    "aarch64": "aarch64",
}


class JanInstallError(RuntimeError):
    """A runtime could not be installed.

    No artifact for this platform, a manifest that does not name what was asked
    for, a digest that does not match, or an archive that holds no binary.
    Distinct from :class:`~jan_adk.JanRuntimeError`, which is a runtime
    that will not run - this is a runtime that could not be fetched.
    """

    def __init__(
        self,
        message: str,
        *,
        url: Optional[str] = None,
        expected: Optional[str] = None,
        actual: Optional[str] = None,
        platform: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.url = url
        self.expected = expected
        self.actual = actual
        self.platform = platform


@dataclass(frozen=True)
class InstalledRuntime:
    """An installed runtime and what it was installed from."""

    version: str
    pub_date: Optional[str]
    platform: str
    url: str
    sha256: str
    installed_at: str
    #: Absolute path to the runtime binary, for ``JanRuntime(bin=...)``.
    bin: str
    dir: str
    root: str
    #: True when the install was already on disk and nothing was downloaded.
    cached: bool


def platform_key(system: Optional[str] = None, machine: Optional[str] = None) -> str:
    """The manifest key for a system/machine pair.

    Raises rather than guessing: an artifact for another architecture extracts
    fine and then fails at exec.
    """
    system = (system or _platform.system()).lower()
    raw_machine = machine or _platform.machine()
    machine = ARCH_ALIASES.get((raw_machine or "").lower())
    if system == "darwin":
        return "darwin-universal"
    if system == "linux" and machine in ("x86_64", "aarch64"):
        return f"linux-{machine}"
    if system == "windows" and machine in ("x86_64", "aarch64"):
        return f"windows-{machine}"
    raise JanInstallError(
        f"the Jan runtime publishes no artifact for {system}/{raw_machine or 'unknown'}; "
        f"it publishes {', '.join(PLATFORM_KEYS)}",
        platform=f"{system}/{raw_machine or 'unknown'}",
    )


def bin_name(platform: Optional[str] = None) -> str:
    """The binary's name inside an installed runtime."""
    return "jan.exe" if (platform or platform_key()).startswith("windows-") else "jan"


def runtime_root(env: Optional[Dict[str, str]] = None) -> str:
    """Where installed runtimes live.

    ``JAN_AGENT_HOME`` when set, otherwise the per-user cache directory each OS
    already has a convention for.
    """
    env = os.environ if env is None else env
    if env.get("JAN_AGENT_HOME"):
        return env["JAN_AGENT_HOME"]
    home = Path.home()
    if os.name == "nt":
        base = Path(env.get("LOCALAPPDATA") or home / "AppData" / "Local")
        return str(base / "jan-agent" / "runtimes")
    if _platform.system().lower() == "darwin":
        return str(home / "Library" / "Caches" / "jan-agent" / "runtimes")
    return str(Path(env.get("XDG_CACHE_HOME") or home / ".cache") / "jan-agent" / "runtimes")


def _valid_version(version: object) -> bool:
    return isinstance(version, str) and re.fullmatch(
        r"[A-Za-z0-9](?:[A-Za-z0-9._+-]*[A-Za-z0-9_+-])?", version
    ) is not None


def _install_dir(root: str, version: str, platform: str) -> Path:
    return Path(root) / version / platform


def find_runtime(version: Optional[str] = None, root: Optional[str] = None) -> Optional[InstalledRuntime]:
    """An installed runtime for ``version``, read from the marker an install writes.

    No network: a caller who already has one pays nothing to find it, and a
    missing one answers ``None`` rather than raising.
    """
    if not _valid_version(version):
        return None
    root = str(Path(root or runtime_root()).resolve())
    platform = platform_key()
    directory = _install_dir(root, version, platform)
    try:
        marker = json.loads((directory / "install.json").read_text())
    except (OSError, ValueError):
        return None
    if (
        not isinstance(marker, dict)
        or marker.get("version") != version
        or marker.get("platform") != platform
        or not isinstance(marker.get("sha256"), str)
        or re.fullmatch(r"[a-f0-9]{64}", marker["sha256"]) is None
        or not isinstance(marker.get("directory"), str)
        or re.fullmatch(rf"{platform}-[a-f0-9-]{{36}}", marker["directory"]) is None
    ):
        return None
    directory = Path(root) / version / marker["directory"]
    binary = directory / bin_name(platform)
    if binary.is_symlink() or not binary.is_file():
        # A marker whose binary is gone is not an install: it is the remains of one.
        return None
    return InstalledRuntime(
        version=marker["version"],
        pub_date=marker.get("pubDate"),
        platform=marker.get("platform", platform),
        url=marker.get("url", ""),
        sha256=marker["sha256"],
        installed_at=marker.get("installedAt", ""),
        bin=str(binary),
        dir=str(directory),
        root=str(root),
        cached=True,
    )


def install_runtime(
    version: Optional[str] = None,
    *,
    sha256: Optional[str] = None,
    manifest_url: Optional[str] = None,
    root: Optional[str] = None,
    on_progress: Optional[Callable[[int, int], None]] = None,
    timeout: float = 120.0,
) -> InstalledRuntime:
    """Install the runtime for this platform and return it.

    ``manifest_url`` names the channel (default: the one above). ``version`` and
    ``sha256`` pin: either is checked against the manifest and a mismatch is an
    error, never a silent fallback. ``on_progress(received, total)`` reports the
    download; ``total`` is 0 when the server sends no length.
    """
    manifest_url = manifest_url or os.environ.get("JAN_AGENT_MANIFEST") or MANIFEST_URL
    root = str(Path(root or runtime_root()).resolve())
    if version is not None and not _valid_version(version):
        raise JanInstallError("version must be a single safe path component")

    platform = platform_key()
    if version:
        hit = find_runtime(version, root)
        if hit is not None and (not sha256 or hit.sha256 == sha256):
            return hit

    manifest = _read_manifest(manifest_url, timeout)
    published = manifest.get("version")
    if version and published != version:
        raise JanInstallError(
            f"the manifest at {manifest_url} publishes {published}, not {version}: "
            "point `manifest_url` at the manifest that names the version you are pinning, or drop it",
            url=manifest_url,
        )
    entry = (manifest.get("platforms") or {}).get(platform)
    if not entry or not entry.get("url") or not entry.get("sha256"):
        raise JanInstallError(
            f"the manifest at {manifest_url} (version {published}) has no entry for {platform}",
            url=manifest_url,
            platform=platform,
        )
    expected = entry["sha256"]
    if sha256 and sha256 != expected:
        raise JanInstallError(
            f"the manifest publishes {expected} for {platform}, not the {sha256} this install pins",
            url=entry["url"],
            expected=sha256,
            actual=expected,
            platform=platform,
        )

    directory = _install_dir(root, published, platform)
    # An install of the version the manifest names, whose digest is still the one
    # the manifest publishes, is the artifact this call would fetch. A channel
    # that republished the same version with different bytes fails this check and
    # is downloaded again, which is the point of recording the digest.
    existing = find_runtime(published, root)
    if existing is not None and existing.sha256 == expected:
        return existing

    directory.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f".{platform}.part-", dir=directory.parent))
    generation = f"{platform}-{uuid.uuid4()}"
    installed_directory = directory.parent / generation
    marker_temp = directory / f".{uuid.uuid4()}.json"
    try:
        archive = stage / (Path(urlparse(entry["url"]).path).name or "jan-runtime")
        actual = _download(entry["url"], archive, on_progress, timeout)
        if actual != expected:
            raise JanInstallError(
                f"the artifact downloaded from {entry['url']} hashes to {actual}, "
                f"not the {expected} the manifest publishes",
                url=entry["url"],
                expected=expected,
                actual=actual,
                platform=platform,
            )
        _extract(archive, stage)
        archive.unlink()

        name = bin_name(platform)
        binary = stage / name
        if binary.is_symlink() or not binary.is_file():
            raise JanInstallError(
                f"the {platform} archive from {entry['url']} holds no {name} at its root",
                url=entry["url"],
                platform=platform,
            )
        if os.name != "nt":
            binary.chmod(0o755)

        installed_at = _now()
        marker = json.dumps(
            {
                "version": published,
                "directory": generation,
                "pubDate": manifest.get("pub_date"),
                "platform": platform,
                "url": entry["url"],
                "sha256": actual,
                "bin": name,
                "installedAt": installed_at,
            },
            indent=2,
        ).encode() + b"\n"

        # Published generations are never replaced: another process can still
        # be using the binary or holding its path under a digest pin. Only the
        # small lookup marker changes atomically; concurrent callers all keep
        # usable paths, regardless of which marker wins.
        os.rename(stage, installed_directory)
        directory.mkdir(parents=True, exist_ok=True)
        with marker_temp.open("xb") as target:
            target.write(marker)
        os.replace(marker_temp, directory / "install.json")
        return InstalledRuntime(
            version=published,
            pub_date=manifest.get("pub_date"),
            platform=platform,
            url=entry["url"],
            sha256=actual,
            installed_at=installed_at,
            bin=str(installed_directory / name),
            dir=str(installed_directory),
            root=str(root),
            cached=False,
        )
    except BaseException:
        marker_temp.unlink(missing_ok=True)
        shutil.rmtree(stage, ignore_errors=True)
        raise


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _read_manifest(url: str, timeout: float) -> Dict[str, object]:
    try:
        with urlopen(Request(url, headers={"accept": "application/json"}), timeout=timeout) as response:
            body = response.read()
    except OSError as error:
        raise JanInstallError(f"could not read the runtime manifest at {url}: {error}", url=url) from error
    try:
        manifest = json.loads(body)
    except ValueError as error:
        raise JanInstallError(f"the runtime manifest at {url} is not JSON: {error}", url=url) from error
    if not isinstance(manifest, dict) or not _valid_version(manifest.get("version")) or not isinstance(manifest.get("platforms"), dict):
        raise JanInstallError(f"the runtime manifest at {url} names no version and no platforms", url=url)
    return manifest


def _download(
    url: str,
    target: Path,
    on_progress: Optional[Callable[[int, int], None]],
    timeout: float,
) -> str:
    """Stream the artifact to ``target``, hashing as it arrives, and answer the digest."""
    digest = hashlib.sha256()
    received = 0
    try:
        with urlopen(Request(url), timeout=timeout) as response, open(target, "wb") as sink:
            total = int(response.headers.get("content-length") or 0)
            while True:
                chunk = response.read(1 << 16)
                if not chunk:
                    break
                digest.update(chunk)
                received += len(chunk)
                sink.write(chunk)
                if on_progress is not None:
                    on_progress(received, total)
    except OSError as error:
        raise JanInstallError(f"could not download the artifact at {url}: {error}", url=url) from error
    return digest.hexdigest()


def _extract(archive: Path, into: Path) -> None:
    """Unpack the artifact into the staging directory.

    ``filter="data"`` refuses members that would land outside ``into`` (a
    traversal, an absolute path, a link out), so a compromised channel cannot
    write anywhere but the staging directory this caller removes on any error.
    """
    try:
        if zipfile.is_zipfile(archive):
            with zipfile.ZipFile(archive) as bundle:
                bundle.extractall(into)
            return
        with tarfile.open(archive) as bundle:
            bundle.extractall(into, filter="data")
    except (tarfile.TarError, zipfile.BadZipFile, OSError, TypeError) as error:
        raise JanInstallError(f"could not extract {archive.name}: {error}", url=str(archive)) from error
