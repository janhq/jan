#!/usr/bin/env python3
"""
Patch crates.io libspa high-level Rust to match newer PipeWire spa_video_info_raw bindgen layouts.

libspa-sys bindgen on newer distros can omit `flags` and use i64 for `modifier`, while libspa-0.9.2's
`param/video/raw.rs` still assumes the older struct. This script applies a small compatibility shim.

TECH DEBT: Remove when upstream libspa matches system headers (track pipewire-rs / libspa releases).
PipeWire Rust bindings: https://gitlab.freedesktop.org/pipewire/pipewire-rs

Exit codes:
  0 - patched successfully, already patched, or crate layout no longer needs this shim
  1 - expected file missing, or patch failed to apply when unpatched code is still present

Usage:
  python3 scripts/patch-libspa.py [path/to/raw.rs]

If no path is given, discovers ~/.cargo/registry/src/*/libspa-0.9.2/src/param/video/raw.rs
(requires `cargo fetch` first in CI).
"""

from __future__ import annotations

import sys
from pathlib import Path

EXPECTED_VERSION_DIR = "libspa-0.9.2"

MARKER_PATCHED_NEW = "let mut s = Self(unsafe { std::mem::zeroed() })"
MARKER_UNPATCHED_SET_FLAGS = "self.0.flags = flags.bits();"


def discover_raw_path() -> Path | None:
    home = Path.home()
    matches = sorted(
        home.glob(f".cargo/registry/src/*/{EXPECTED_VERSION_DIR}/src/param/video/raw.rs")
    )
    return matches[0] if matches else None


def apply_patch(s: str) -> str:
    s = s.replace(
        "    pub fn new() -> Self {\n        Self(spa_sys::spa_video_info_raw {\n            format: VideoFormat::Unknown.as_raw(),\n            flags: 0,\n            modifier: 0,\n            size: Rectangle {\n                width: 0,\n                height: 0,\n            },\n            framerate: Fraction { num: 0, denom: 0 },\n            max_framerate: Fraction { num: 0, denom: 0 },\n            views: 0,\n            interlace_mode: VideoInterlaceMode::Progressive.as_raw(),\n            pixel_aspect_ratio: Fraction { num: 0, denom: 0 },\n            multiview_mode: 0,\n            multiview_flags: 0,\n            chroma_site: 0,\n            color_range: 0,\n            color_matrix: 0,\n            transfer_function: 0,\n            color_primaries: 0,\n        })\n    }\n",
        "    pub fn new() -> Self {\n        let mut s = Self(unsafe { std::mem::zeroed() });\n        s.set_format(VideoFormat::Unknown);\n        s\n    }\n",
    )
    s = s.replace(
        "    pub fn set_flags(&mut self, flags: VideoFlags) {\n        self.0.flags = flags.bits();\n    }\n",
        "    pub fn set_flags(&mut self, _flags: VideoFlags) {\n    }\n",
    )
    s = s.replace(
        "    pub fn flags(self) -> VideoFlags {\n        VideoFlags::from_bits_retain(self.0.flags)\n    }\n",
        "    pub fn flags(self) -> VideoFlags {\n        VideoFlags::from_bits_retain(0)\n    }\n",
    )
    s = s.replace(
        "    pub fn set_modifier(&mut self, modifier: u64) {\n        self.0.modifier = modifier;\n    }\n",
        "    pub fn set_modifier(&mut self, modifier: u64) {\n        self.0.modifier = modifier as _;\n    }\n",
    )
    s = s.replace(
        "    pub fn modifier(self) -> u64 {\n        self.0.modifier\n    }\n",
        "    pub fn modifier(self) -> u64 {\n        self.0.modifier as _\n    }\n",
    )
    return s


def verify_patched(s: str) -> None:
    if MARKER_UNPATCHED_SET_FLAGS in s:
        raise RuntimeError("patch incomplete: set_flags still assigns self.0.flags")
    i = s.find("pub fn set_modifier")
    if i != -1:
        chunk = s[i : i + 160]
        if "self.0.modifier = modifier;" in chunk and "as _" not in chunk:
            raise RuntimeError("patch incomplete: set_modifier missing cast")


def main() -> int:
    raw_arg = sys.argv[1] if len(sys.argv) > 1 else None
    path = Path(raw_arg) if raw_arg else discover_raw_path()
    if path is None or not path.is_file():
        print(
            "error: libspa param/video/raw.rs not found "
            "(run `cargo fetch --manifest-path src-tauri/Cargo.toml` first)",
            file=sys.stderr,
        )
        return 1

    if EXPECTED_VERSION_DIR not in path.as_posix():
        print(
            f"warning: path does not contain {EXPECTED_VERSION_DIR}: {path}",
            file=sys.stderr,
        )

    original = path.read_text(encoding="utf-8")
    patched = apply_patch(original)

    if patched != original:
        try:
            verify_patched(patched)
        except RuntimeError as e:
            print(f"error: {e}", file=sys.stderr)
            return 1
        path.write_text(patched, encoding="utf-8")
        print(f"ok: patched {path}")
        return 0

    # No textual change from replace()
    if MARKER_PATCHED_NEW in original:
        print(f"skip: already patched: {path}")
        return 0
    if MARKER_UNPATCHED_SET_FLAGS not in original:
        print(f"skip: layout differs (no unpatched set_flags); not applying: {path}")
        return 0

    print(
        "error: patch did not apply but unpatched code still present — "
        "libspa source may have changed; update scripts/patch-libspa.py",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
