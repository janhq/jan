// Copyright The pipewire-rs Contributors.
// SPDX-License-Identifier: MIT

use crate::param::audio::AudioFormat;
use crate::pod::{Property, Value, ValueArray};
use crate::utils::{
    self,
    result::{Error, SpaResult, SpaSuccess},
};
use std::fmt::Debug;

bitflags::bitflags! {
    #[derive(Debug, PartialEq, Eq, Clone, Copy)]
    pub struct AudioInfoRawFlags: u32 {
        /// the position array explicitly contains unpositioned channels.
        const UNPOSITIONED = 1<<0;
    }
}

/// Rust representation of [`spa_sys::spa_audio_info_raw`].
#[repr(transparent)]
#[derive(PartialEq, Eq, Clone, Copy)]
pub struct AudioInfoRaw(spa_sys::spa_audio_info_raw);

impl AudioInfoRaw {
    pub fn new() -> Self {
        Self(spa_sys::spa_audio_info_raw {
            format: AudioFormat::Unknown.as_raw(),
            flags: AudioInfoRawFlags::UNPOSITIONED.bits(),
            rate: 0,
            channels: 0,
            position: [0; 64usize],
        })
    }

    pub fn set_format(&mut self, format: AudioFormat) {
        self.0.format = format.as_raw();
    }

    pub fn format(&self) -> AudioFormat {
        AudioFormat::from_raw(self.0.format)
    }

    pub fn set_flags(&mut self, flags: AudioInfoRawFlags) {
        self.0.flags = flags.bits();
    }

    pub fn flags(&self) -> AudioInfoRawFlags {
        AudioInfoRawFlags::from_bits_retain(self.0.flags)
    }

    pub fn set_rate(&mut self, rate: u32) {
        self.0.rate = rate;
    }

    pub fn rate(&self) -> u32 {
        self.0.rate
    }

    pub fn set_channels(&mut self, channels: u32) {
        self.0.channels = channels;
    }

    pub fn channels(&self) -> u32 {
        self.0.channels
    }

    pub fn set_position(&mut self, position: [u32; 64usize]) {
        self.0.position = position;
        if position[0] == 0 {
            self.0.flags |= AudioInfoRawFlags::UNPOSITIONED.bits();
        } else {
            self.0.flags &= AudioInfoRawFlags::UNPOSITIONED.complement().bits();
        };
    }

    pub fn position(&self) -> [u32; 64usize] {
        self.0.position
    }

    /// helper function to parse format properties type
    pub fn parse(&mut self, format: &crate::pod::Pod) -> Result<SpaSuccess, Error> {
        let res = unsafe { spa_sys::spa_format_audio_raw_parse(format.as_raw_ptr(), &mut self.0) };
        SpaResult::from_c(res).into_result()
    }

    /// Obtain an [`AudioInfoRaw`] from a raw `spa_audio_info_raw` variant.
    pub fn from_raw(raw: spa_sys::spa_audio_info_raw) -> Self {
        Self(raw)
    }

    /// Get the raw [`spa_sys::spa_audio_info_raw`] representing this `AudioInfoRaw`.
    pub fn as_raw(&self) -> spa_sys::spa_audio_info_raw {
        self.0
    }
}

impl Default for AudioInfoRaw {
    fn default() -> Self {
        Self::new()
    }
}

impl From<AudioInfoRaw> for Vec<Property> {
    fn from(value: AudioInfoRaw) -> Self {
        let mut props = Vec::with_capacity(6);
        props.push(Property::new(
            spa_sys::SPA_FORMAT_mediaType,
            Value::Id(utils::Id(spa_sys::SPA_MEDIA_TYPE_audio)),
        ));
        props.push(Property::new(
            spa_sys::SPA_FORMAT_mediaSubtype,
            Value::Id(utils::Id(spa_sys::SPA_MEDIA_SUBTYPE_raw)),
        ));

        if value.format() != AudioFormat::Unknown {
            props.push(Property::new(
                spa_sys::SPA_FORMAT_AUDIO_format,
                Value::Id(utils::Id(value.format().as_raw())),
            ));
        }

        if value.rate() != 0 {
            props.push(Property::new(
                spa_sys::SPA_FORMAT_AUDIO_rate,
                Value::Int(value.rate() as i32),
            ));
        }

        if value.channels() != 0 {
            props.push(Property::new(
                spa_sys::SPA_FORMAT_AUDIO_channels,
                Value::Int(value.channels() as i32),
            ));
            if !value.flags().contains(AudioInfoRawFlags::UNPOSITIONED) {
                let array = value.position()[0..value.channels() as usize]
                    .iter()
                    .copied()
                    .map(utils::Id)
                    .collect();
                props.push(Property::new(
                    spa_sys::SPA_FORMAT_AUDIO_position,
                    Value::ValueArray(ValueArray::Id(array)),
                ));
            }
        }

        props
    }
}

impl Debug for AudioInfoRaw {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AudioInfoRaw")
            .field("format", &self.format())
            .field("flags", &self.flags())
            .field("rate", &self.rate())
            .field("channels", &self.channels())
            .field("position", &self.position())
            .finish()
    }
}
