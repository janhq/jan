"""Installing a runtime, against a manifest this test serves itself.

Nothing here touches the network: an HTTP server in this process publishes a
manifest and a tarball this test builds with :mod:`tarfile`, so the whole path -
manifest, platform key, download, digest, extract, rename - runs for real. What
is faked is only the channel. No runtime and no ``JAN_BIN`` are needed, which is
the point: getting a runtime is what is under test.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import tarfile
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jan_agent_sdk import (  # noqa: E402
    MANIFEST_URL,
    PLATFORM_KEYS,
    JanInstallError,
    bin_name,
    find_runtime,
    install_runtime,
    platform_key,
    runtime_root,
)

VERSION = "0.0.0-test"


def make_archive(directory: Path, *, member: Optional[str] = None, content: str = VERSION) -> Path:
    """A tarball holding a ``jan`` that is executable and does nothing.

    The installer only has to put a binary there; whether it runs is the
    runtime's business. ``member`` overrides the name inside the archive, which
    is how the traversal case below gets built.
    """
    staged = directory / "staged"
    staged.mkdir(parents=True, exist_ok=True)
    name = bin_name()
    (staged / name).write_text(f"#!/bin/sh\necho {content}\n")
    archive = directory / "jan-runtime.tar.gz"
    with tarfile.open(archive, "w:gz") as bundle:
        bundle.add(staged / name, arcname=member or name)
    return archive


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class _Channel:
    """A channel: ``/manifest.json`` and the artifact, counted.

    The count is what proves a cached install downloaded nothing, and what
    proves a refused pin downloaded nothing at all.
    """

    def __init__(self, archive: Path, *, version: str = VERSION, digest: Optional[str] = None,
                 omit_platform: bool = False) -> None:
        self.bytes = archive.read_bytes()
        self.version = version
        self.digest = digest or sha256(self.bytes)
        self.omit_platform = omit_platform
        self.requests: List[str] = []
        self.artifacts = 0

        channel = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:  # keep the test output clean
                pass

            def do_GET(self) -> None:  # noqa: N802 - the name http.server wants
                channel.requests.append(self.path)
                if self.path == "/manifest.json":
                    platforms: Dict[str, Dict[str, str]] = {
                        platform_key(): {
                            "url": f"http://127.0.0.1:{self.server.server_port}/jan-runtime.tar.gz",
                            "sha256": channel.digest,
                        }
                    }
                    if channel.omit_platform:
                        platforms.pop(platform_key(), None)
                    body = json.dumps(
                        {"version": channel.version, "pub_date": "2026-01-01T00:00:00.000Z", "platforms": platforms}
                    ).encode()
                    self.send_response(200)
                    self.send_header("content-type", "application/json")
                    self.send_header("content-length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                channel.artifacts += 1
                self.send_response(200)
                self.send_header("content-type", "application/gzip")
                self.send_header("content-length", str(len(channel.bytes)))
                self.end_headers()
                self.wfile.write(channel.bytes)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}/manifest.json"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


class InstallTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="jan-install-"))
        self.source = Path(tempfile.mkdtemp(prefix="jan-install-src-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)
        shutil.rmtree(self.source, ignore_errors=True)

    # -- the platform table -------------------------------------------------

    def test_a_platform_maps_to_the_artifact_the_manifest_publishes(self) -> None:
        self.assertEqual(platform_key("Darwin", "arm64"), "darwin-universal")
        self.assertEqual(platform_key("Darwin", "x86_64"), "darwin-universal")
        self.assertEqual(platform_key("Linux", "x86_64"), "linux-x86_64")
        self.assertEqual(platform_key("Linux", "AMD64"), "linux-x86_64")
        self.assertEqual(platform_key("Linux", "aarch64"), "linux-aarch64")
        self.assertEqual(platform_key("Windows", "AMD64"), "windows-x86_64")
        self.assertEqual(platform_key("Windows", "ARM64"), "windows-aarch64")
        with self.assertRaises(JanInstallError) as caught:
            platform_key("SunOS", "sparc")
        self.assertIn("sunos/sparc", str(caught.exception))
        self.assertIn("darwin-universal", str(caught.exception))
        for key in PLATFORM_KEYS:
            self.assertIn(bin_name(key), ("jan", "jan.exe"))

    def test_the_runtime_root_follows_jan_agent_home(self) -> None:
        self.assertEqual(runtime_root({"JAN_AGENT_HOME": str(self.root)}), str(self.root))
        default = runtime_root({})
        self.assertNotEqual(default, str(self.root))
        self.assertTrue(default.endswith(os.path.join("jan-agent", "runtimes")), default)
        self.assertEqual(MANIFEST_URL, "https://delta.jan.ai/agent-nightly/manifest.json")

    # -- install, cache, verify ---------------------------------------------

    def test_an_install_lands_a_verified_executable_binary_and_is_cached_after_that(self) -> None:
        archive = make_archive(self.source)
        published = _Channel(archive)
        try:
            progress: List[int] = []
            installed = install_runtime(
                manifest_url=published.url, root=str(self.root), on_progress=lambda got, _total: progress.append(got)
            )

            self.assertEqual(installed.version, VERSION)
            self.assertEqual(installed.platform, platform_key())
            self.assertFalse(installed.cached)
            # The digest is the archive's, which is what the manifest pins and
            # what a caller recomputes from the published artifact.
            self.assertEqual(installed.sha256, sha256(archive.read_bytes()))
            self.assertTrue(os.access(installed.bin, os.X_OK), "the binary is executable")
            self.assertTrue(progress, "progress was reported")

            # The marker is what makes it findable without the network, and what
            # the next install reads instead of downloading again.
            found = find_runtime(VERSION, str(self.root))
            self.assertIsNotNone(found)
            assert found is not None
            self.assertEqual(found.bin, installed.bin)
            self.assertTrue(found.cached)
            self.assertEqual(found.sha256, installed.sha256)

            before = len(published.requests)
            again = install_runtime(version=VERSION, manifest_url=published.url, root=str(self.root))
            self.assertTrue(again.cached)
            self.assertEqual(len(published.requests), before, "a cached install fetches nothing")
            self.assertEqual(published.artifacts, 1, "the artifact was downloaded once")

            # Pinned to what the manifest publishes, an install is a cache read.
            pinned = install_runtime(
                version=VERSION, sha256=found.sha256, manifest_url=published.url, root=str(self.root)
            )
            self.assertTrue(pinned.cached)

            # And so is one that pins nothing: the manifest names the version
            # already installed, with the digest it was installed under.
            unpinned = install_runtime(manifest_url=published.url, root=str(self.root))
            self.assertTrue(unpinned.cached)
            self.assertEqual(unpinned.version, VERSION)
            self.assertEqual(published.artifacts, 1, "still one download for the whole test")
        finally:
            published.close()

    def test_a_channel_that_republishes_a_version_under_a_new_digest_installs_again(self) -> None:
        first = _Channel(make_archive(self.source))
        self.addCleanup(first.close)
        installed = install_runtime(manifest_url=first.url, root=str(self.root))
        self.assertFalse(installed.cached)

        # Same version, different bytes: the recorded digest is what tells the
        # two apart, so this is a re-install rather than a cache hit.
        rebuilt = self.source / "second"
        rebuilt.mkdir(parents=True, exist_ok=True)
        second = _Channel(make_archive(rebuilt, content="replacement"))
        try:
            again = install_runtime(manifest_url=second.url, root=str(self.root))
            self.assertEqual(again.version, VERSION)
            self.assertFalse(again.cached, "a republished digest is not the install on disk")
            self.assertNotEqual(again.sha256, installed.sha256)
            self.assertEqual(again.sha256, sha256((rebuilt / "jan-runtime.tar.gz").read_bytes()))
            self.assertEqual(Path(installed.bin).read_text(), f"#!/bin/sh\necho {VERSION}\n")
            self.assertEqual(Path(again.bin).read_text(), "#!/bin/sh\necho replacement\n")
        finally:
            second.close()

    def test_a_digest_that_does_not_match_is_an_error_and_leaves_nothing_behind(self) -> None:
        published = _Channel(make_archive(self.source), digest="f" * 64)
        self.addCleanup(published.close)
        with self.assertRaises(JanInstallError) as caught:
            install_runtime(manifest_url=published.url, root=str(self.root))
        error = caught.exception
        self.assertEqual(error.expected, "f" * 64)
        self.assertNotEqual(error.actual, error.expected)
        self.assertIn("hashes to", str(error))
        self.assertIsNone(find_runtime(VERSION, str(self.root)))
        self.assertFalse((self.root / VERSION / platform_key()).exists(), "no directory survives a bad digest")
        self.assertEqual(list((self.root / VERSION).iterdir()), [], "no staging directory survives")

    def test_a_version_or_digest_the_manifest_does_not_publish_is_refused_not_substituted(self) -> None:
        published = _Channel(make_archive(self.source))
        self.addCleanup(published.close)
        with self.assertRaises(JanInstallError) as caught:
            install_runtime(version="0.0.0-other", manifest_url=published.url, root=str(self.root))
        self.assertIn("publishes 0.0.0-test, not 0.0.0-other", str(caught.exception))
        with self.assertRaises(JanInstallError) as caught:
            install_runtime(sha256="a" * 64, manifest_url=published.url, root=str(self.root))
        self.assertIn(f"not the {'a' * 64} this install pins", str(caught.exception))
        self.assertEqual(published.artifacts, 0, "nothing was downloaded for a refused pin")

    def test_a_manifest_without_this_platform_is_an_error_naming_what_it_has(self) -> None:
        published = _Channel(make_archive(self.source), omit_platform=True)
        self.addCleanup(published.close)
        with self.assertRaises(JanInstallError) as caught:
            install_runtime(manifest_url=published.url, root=str(self.root))
        self.assertIn(f"no entry for {platform_key()}", str(caught.exception))
        self.assertEqual(caught.exception.platform, platform_key())

    def test_a_marker_without_a_binary_is_not_an_install(self) -> None:
        directory = self.root / VERSION / platform_key()
        directory.mkdir(parents=True)
        (directory / "install.json").write_text(json.dumps({"version": VERSION, "bin": bin_name()}))
        self.assertIsNone(find_runtime(VERSION, str(self.root)))
        self.assertIsNone(find_runtime(None, str(self.root)))
        self.assertIsNone(find_runtime(VERSION, str(self.root / "elsewhere")))

    def test_concurrent_installs_preserve_every_returned_binary(self) -> None:
        published = _Channel(make_archive(self.source))
        self.addCleanup(published.close)
        barrier = threading.Barrier(4)

        def install():
            barrier.wait(timeout=10)
            return install_runtime(root=str(self.root), manifest_url=published.url)

        with ThreadPoolExecutor(max_workers=4) as pool:
            installs = list(pool.map(lambda _: install(), range(4)))
        for installed in installs:
            self.assertEqual(Path(installed.bin).read_text(), f"#!/bin/sh\necho {VERSION}\n")

    def test_relative_root_returns_an_absolute_binary(self) -> None:
        published = _Channel(make_archive(self.source))
        self.addCleanup(published.close)
        installed = install_runtime(root=os.path.relpath(self.root), manifest_url=published.url)
        self.assertTrue(Path(installed.bin).is_absolute())

    def test_untrusted_version_path_is_refused_before_download(self) -> None:
        published = _Channel(make_archive(self.source), version="../escaped")
        self.addCleanup(published.close)
        with self.assertRaises(JanInstallError):
            install_runtime(root=str(self.root / "cache"), manifest_url=published.url)
        self.assertEqual(published.artifacts, 0)

    def test_unsupported_safe_extraction_never_falls_back(self) -> None:
        published = _Channel(make_archive(self.source))
        self.addCleanup(published.close)
        with patch.object(tarfile.TarFile, "extractall", side_effect=TypeError("no filter")) as extract:
            with self.assertRaises(JanInstallError):
                install_runtime(root=str(self.root), manifest_url=published.url)
        self.assertEqual(extract.call_count, 1)

    # -- the archive ---------------------------------------------------------

    def test_an_archive_that_escapes_the_staging_directory_is_refused(self) -> None:
        """A member outside the staging directory is refused, not followed.

        The install directory is the caller's, so an archive that can write
        anywhere else is the one thing an installer must not accept - including
        from a channel whose digest matched, because the next publish is not the
        one that was reviewed.
        """
        archive = make_archive(self.source, member="../escaped")
        published = _Channel(archive)
        self.addCleanup(published.close)
        with self.assertRaises(JanInstallError) as caught:
            install_runtime(manifest_url=published.url, root=str(self.root))
        self.assertIn("could not extract", str(caught.exception))
        self.assertFalse((self.root / VERSION / "escaped").exists())
        self.assertFalse((self.source / "escaped").exists())


if __name__ == "__main__":
    unittest.main()
