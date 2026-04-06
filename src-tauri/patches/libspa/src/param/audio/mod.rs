// Copyright The pipewire-rs Contributors.
// SPDX-License-Identifier: MIT

mod raw;
pub use raw::*;

use std::ffi::CStr;
use std::fmt::Debug;
use std::ops::Range;

pub const MAX_CHANNELS: usize = spa_sys::SPA_AUDIO_MAX_CHANNELS as usize;

#[repr(transparent)]
#[derive(PartialEq, PartialOrd, Eq, Clone, Copy)]
pub struct AudioFormat(pub spa_sys::spa_audio_format);

#[allow(non_upper_case_globals)]
impl AudioFormat {
    pub const Unknown: Self = Self(spa_sys::SPA_AUDIO_FORMAT_UNKNOWN);
    pub const Encoded: Self = Self(spa_sys::SPA_AUDIO_FORMAT_ENCODED);
    pub const S8: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S8);
    pub const U8: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U8);
    pub const S16LE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S16_LE);
    pub const S16BE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S16_BE);
    pub const U16LE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U16_LE);
    pub const U16BE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U16_BE);
    pub const S24_32LE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S24_32_LE);
    pub const S24_32BE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S24_32_BE);
    pub const U24_32LE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U24_32_LE);
    pub const U24_32BE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U24_32_BE);
    pub const S32LE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S32_LE);
    pub const S32BE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S32_BE);
    pub const U32LE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U32_LE);
    pub const U32BE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U32_BE);
    pub const S24LE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S24_LE);
    pub const S24BE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S24_BE);
    pub const U24LE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U24_LE);
    pub const U24BE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U24_BE);
    pub const S20LE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S20_LE);
    pub const S20BE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S20_BE);
    pub const U20LE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U20_LE);
    pub const U20BE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U20_BE);
    pub const S18LE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S18_LE);
    pub const S18BE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S18_BE);
    pub const U18LE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U18_LE);
    pub const U18BE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U18_BE);
    pub const F32LE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_F32_LE);
    pub const F32BE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_F32_BE);
    pub const F64LE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_F64_LE);
    pub const F64BE: Self = Self(spa_sys::SPA_AUDIO_FORMAT_F64_BE);
    pub const ULAW: Self = Self(spa_sys::SPA_AUDIO_FORMAT_ULAW);
    pub const ALAW: Self = Self(spa_sys::SPA_AUDIO_FORMAT_ALAW);

    pub const S16: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S16);
    pub const U16: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U16);
    pub const S18: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S18);
    pub const U18: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U18);
    pub const S20: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S20);
    pub const U20: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U20);
    pub const S24: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S24);
    pub const U24: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U24);
    pub const S32: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S32);
    pub const U32: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U32);

    pub const U8P: Self = Self(spa_sys::SPA_AUDIO_FORMAT_U8P);
    pub const S16P: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S16P);
    pub const S24_32P: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S24_32P);
    pub const S32P: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S32P);
    pub const S24P: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S24P);
    pub const F32P: Self = Self(spa_sys::SPA_AUDIO_FORMAT_F32P);
    pub const F64P: Self = Self(spa_sys::SPA_AUDIO_FORMAT_F64P);
    pub const S8P: Self = Self(spa_sys::SPA_AUDIO_FORMAT_S8P);

    const INTERLEAVED_RANGE: Range<Self> = Self::S8..Self(spa_sys::SPA_AUDIO_FORMAT_START_Planar);
    const PLANAR_RANGE: Range<Self> = Self::U8P..Self(spa_sys::SPA_AUDIO_FORMAT_START_Other);

    pub fn is_interleaved(&self) -> bool {
        Self::INTERLEAVED_RANGE.contains(self)
    }

    pub fn is_planar(&self) -> bool {
        Self::PLANAR_RANGE.contains(self)
    }

    /// Obtain an [`AudioFormat`] from a raw `spa_audio_format` variant.
    pub fn from_raw(raw: spa_sys::spa_audio_format) -> Self {
        Self(raw)
    }

    /// Get the raw [`spa_sys::spa_audio_format`] representing this `AudioFormat`.
    pub fn as_raw(&self) -> spa_sys::spa_audio_format {
        self.0
    }
}

impl Debug for AudioFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match *self {
            AudioFormat::Unknown => f.write_str("AudioFormat::Unknown"),
            AudioFormat::Encoded => f.write_str("AudioFormat::Encoded"),
            _ => {
                let c_str = unsafe {
                    let c_buf = spa_sys::spa_debug_type_find_short_name(
                        spa_sys::spa_type_audio_format,
                        self.as_raw(),
                    );
                    if c_buf.is_null() {
                        return f.write_str("Unsupported");
                    }
                    CStr::from_ptr(c_buf)
                };
                let name = format!("AudioFormat::{}", c_str.to_str().unwrap());
                f.write_str(&name)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg_attr(miri, ignore)]
    fn debug_format() {
        assert_eq!(
            "AudioFormat::Unknown",
            format!("{:?}", AudioFormat::Unknown)
        );
        assert_eq!(
            "AudioFormat::S24_32LE",
            format!("{:?}", AudioFormat::S24_32LE)
        );
    }
}
