// Copyright The pipewire-rs Contributors.
// SPDX-License-Identifier: MIT

//! Types for dealing with SPA formats.

use convert_case::{Case, Casing};
use std::ffi::CStr;
use std::fmt::Debug;
use std::ops::Range;

/// Different media types
#[derive(PartialEq, Eq, Clone, Copy)]
pub struct MediaType(pub spa_sys::spa_media_type);

#[allow(non_upper_case_globals)]
impl MediaType {
    pub const Unknown: Self = Self(spa_sys::SPA_MEDIA_TYPE_unknown);
    pub const Audio: Self = Self(spa_sys::SPA_MEDIA_TYPE_audio);
    pub const Video: Self = Self(spa_sys::SPA_MEDIA_TYPE_video);
    pub const Image: Self = Self(spa_sys::SPA_MEDIA_TYPE_image);
    pub const Binary: Self = Self(spa_sys::SPA_MEDIA_TYPE_binary);
    pub const Stream: Self = Self(spa_sys::SPA_MEDIA_TYPE_stream);
    pub const Application: Self = Self(spa_sys::SPA_MEDIA_TYPE_application);

    /// Obtain a [`MediaType`] from a raw `spa_media_type` variant.
    pub fn from_raw(raw: spa_sys::spa_media_type) -> Self {
        Self(raw)
    }

    /// Get the raw [`spa_sys::spa_media_type`] representing this `MediaType`.
    pub fn as_raw(&self) -> spa_sys::spa_media_type {
        self.0
    }
}

impl Debug for MediaType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let c_str = unsafe {
            let c_buf = spa_sys::spa_debug_type_find_short_name(
                spa_sys::spa_type_media_type,
                self.as_raw(),
            );
            if c_buf.is_null() {
                return f.write_str("Unsupported media type");
            }
            CStr::from_ptr(c_buf)
        };
        let name = format!(
            "MediaType::{}",
            c_str.to_string_lossy().to_case(Case::Pascal)
        );
        f.write_str(&name)
    }
}

/// Different media sub-types
#[derive(PartialEq, PartialOrd, Eq, Clone, Copy)]
pub struct MediaSubtype(pub spa_sys::spa_media_subtype);

#[allow(non_upper_case_globals)]
impl MediaSubtype {
    pub const Unknown: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_unknown);
    pub const Raw: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_raw);
    pub const Dsp: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_dsp);
    /// S/PDIF
    pub const Iec958: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_iec958);
    pub const Dsd: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_dsd);

    pub const Mp3: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_mp3);
    pub const Aac: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_aac);
    pub const Vorbis: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_vorbis);
    pub const Wma: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_wma);
    pub const Ra: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_ra);
    pub const Sbc: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_sbc);
    pub const Adpcm: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_adpcm);
    pub const G723: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_g723);
    pub const G726: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_g726);
    pub const G729: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_g729);
    pub const Amr: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_amr);
    pub const Gsm: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_gsm);
    #[cfg(feature = "v0_3_65")]
    pub const Alac: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_alac);
    #[cfg(feature = "v0_3_65")]
    pub const Flac: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_flac);
    #[cfg(feature = "v0_3_65")]
    pub const Ape: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_ape);
    #[cfg(feature = "v0_3_65")]
    pub const Opus: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_opus);

    pub const H264: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_h264);
    pub const Mjpg: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_mjpg);
    pub const Dv: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_dv);
    pub const Mpegts: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_mpegts);
    pub const H263: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_h263);
    pub const Mpeg1: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_mpeg1);
    pub const Mpeg2: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_mpeg2);
    pub const Mpeg4: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_mpeg4);
    pub const Xvid: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_xvid);
    pub const Vc1: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_vc1);
    pub const Vp8: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_vp8);
    pub const Vp9: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_vp9);
    pub const Bayer: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_bayer);

    pub const Jpeg: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_jpeg);

    pub const Midi: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_midi);

    /// control stream, data contains spa_pod_sequence with control info.
    pub const Control: Self = Self(spa_sys::SPA_MEDIA_SUBTYPE_control);

    const AUDIO_RANGE: Range<Self> = Self::Mp3..Self(spa_sys::SPA_MEDIA_SUBTYPE_START_Video);
    const VIDEO_RANGE: Range<Self> = Self::H264..Self(spa_sys::SPA_MEDIA_SUBTYPE_START_Image);
    const IMAGE_RANGE: Range<Self> = Self::Jpeg..Self(spa_sys::SPA_MEDIA_SUBTYPE_START_Binary);
    const BINARY_RANGE: Range<Self> = Self(spa_sys::SPA_MEDIA_SUBTYPE_START_Binary)
        ..Self(spa_sys::SPA_MEDIA_SUBTYPE_START_Stream);
    const STREAM_RANGE: Range<Self> =
        Self::Midi..Self(spa_sys::SPA_MEDIA_SUBTYPE_START_Application);
    const APPLICATION_RANGE: Range<Self> = Self::Control..Self(spa_sys::spa_media_subtype::MAX);

    pub fn is_audio(&self) -> bool {
        Self::AUDIO_RANGE.contains(self)
    }

    pub fn is_video(&self) -> bool {
        Self::VIDEO_RANGE.contains(self)
    }

    pub fn is_image(&self) -> bool {
        Self::IMAGE_RANGE.contains(self)
    }

    pub fn is_binary(&self) -> bool {
        Self::BINARY_RANGE.contains(self)
    }

    pub fn is_stream(&self) -> bool {
        Self::STREAM_RANGE.contains(self)
    }

    pub fn is_application(&self) -> bool {
        Self::APPLICATION_RANGE.contains(self)
    }

    /// Obtain a [`MediaSubtype`] from a raw `spa_media_subtype` variant.
    pub fn from_raw(raw: spa_sys::spa_media_subtype) -> Self {
        Self(raw)
    }

    /// Get the raw [`spa_sys::spa_media_subtype`] representing this `MediaSubtype`.
    pub fn as_raw(&self) -> spa_sys::spa_media_subtype {
        self.0
    }
}

impl Debug for MediaSubtype {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let c_str = unsafe {
            let c_buf = spa_sys::spa_debug_type_find_short_name(
                spa_sys::spa_type_media_subtype,
                self.as_raw(),
            );
            if c_buf.is_null() {
                return f.write_str("Unsupported media subtype");
            }
            CStr::from_ptr(c_buf)
        };
        let name = format!(
            "MediaSubtype::{}",
            c_str.to_string_lossy().to_case(Case::Pascal)
        );
        f.write_str(&name)
    }
}

#[derive(PartialEq, PartialOrd, Eq, Clone, Copy)]
pub struct FormatProperties(pub spa_sys::spa_format);

#[allow(non_upper_case_globals)]
impl FormatProperties {
    /// media type (Id enum spa_media_type)
    pub const MediaType: Self = Self(spa_sys::SPA_FORMAT_mediaType);
    /// media subtype (Id enum spa_media_subtype)
    pub const MediaSubtype: Self = Self(spa_sys::SPA_FORMAT_mediaSubtype);

    /// audio format, (Id enum spa_audio_format)
    pub const AudioFormat: Self = Self(spa_sys::SPA_FORMAT_AUDIO_format);
    /// optional flags (Int)
    pub const AudioFlags: Self = Self(spa_sys::SPA_FORMAT_AUDIO_flags);
    /// sample rate (Int)
    pub const AudioRate: Self = Self(spa_sys::SPA_FORMAT_AUDIO_rate);
    /// number of audio channels (Int)
    pub const AudioChannels: Self = Self(spa_sys::SPA_FORMAT_AUDIO_channels);
    /// channel positions (Id enum spa_audio_position)
    pub const AudioPosition: Self = Self(spa_sys::SPA_FORMAT_AUDIO_position);

    /// codec used (IEC958) (Id enum spa_audio_iec958_codec)
    pub const AudioIec958Codec: Self = Self(spa_sys::SPA_FORMAT_AUDIO_iec958Codec);

    /// bit order (Id enum spa_param_bitorder)
    pub const AudioBitorder: Self = Self(spa_sys::SPA_FORMAT_AUDIO_bitorder);
    /// Interleave bytes (Int)
    pub const AudioInterleave: Self = Self(spa_sys::SPA_FORMAT_AUDIO_interleave);
    /// bit rate (Int)
    #[cfg(feature = "v0_3_65")]
    pub const AudioBitrate: Self = Self(spa_sys::SPA_FORMAT_AUDIO_bitrate);
    /// audio data block alignment (Int)
    #[cfg(feature = "v0_3_65")]
    pub const AudioBlockAlign: Self = Self(spa_sys::SPA_FORMAT_AUDIO_blockAlign);

    /// AAC stream format, (Id enum spa_audio_aac_stream_format)
    #[cfg(feature = "v0_3_65")]
    pub const AudioAacStreamFormat: Self = Self(spa_sys::SPA_FORMAT_AUDIO_AAC_streamFormat);

    /// WMA profile (Id enum spa_audio_wma_profile)
    #[cfg(feature = "v0_3_65")]
    pub const AudioWmaProfile: Self = Self(spa_sys::SPA_FORMAT_AUDIO_WMA_profile);

    /// AMR band mode (Id enum spa_audio_amr_band_mode)
    #[cfg(feature = "v0_3_65")]
    pub const AudioAmrBandMode: Self = Self(spa_sys::SPA_FORMAT_AUDIO_AMR_bandMode);

    /// video format (Id enum spa_video_format)
    pub const VideoFormat: Self = Self(spa_sys::SPA_FORMAT_VIDEO_format);
    /// format modifier (Long), use only with DMA-BUF and omit for other buffer types
    pub const VideoModifier: Self = Self(spa_sys::SPA_FORMAT_VIDEO_modifier);
    /// size (Rectangle)
    pub const VideoSize: Self = Self(spa_sys::SPA_FORMAT_VIDEO_size);
    /// frame rate (Fraction)
    pub const VideoFramerate: Self = Self(spa_sys::SPA_FORMAT_VIDEO_framerate);
    /// maximum frame rate (Fraction)
    pub const VideoMaxFramerate: Self = Self(spa_sys::SPA_FORMAT_VIDEO_maxFramerate);
    /// number of views (Int)
    pub const VideoViews: Self = Self(spa_sys::SPA_FORMAT_VIDEO_views);
    /// (Id enum spa_video_interlace_mode)
    pub const VideoInterlaceMode: Self = Self(spa_sys::SPA_FORMAT_VIDEO_interlaceMode);
    /// (Rectangle)
    pub const VideoPixelAspectRatio: Self = Self(spa_sys::SPA_FORMAT_VIDEO_pixelAspectRatio);
    /// (Id enum spa_video_multiview_mode)
    pub const VideoMultiviewMode: Self = Self(spa_sys::SPA_FORMAT_VIDEO_multiviewMode);
    /// (Id enum spa_video_multiview_flags)
    pub const VideoMultiviewFlags: Self = Self(spa_sys::SPA_FORMAT_VIDEO_multiviewFlags);
    /// /Id enum spa_video_chroma_site)
    pub const VideoChromaSite: Self = Self(spa_sys::SPA_FORMAT_VIDEO_chromaSite);
    /// /Id enum spa_video_color_range)
    pub const VideoColorRange: Self = Self(spa_sys::SPA_FORMAT_VIDEO_colorRange);
    /// /Id enum spa_video_color_matrix)
    pub const VideoColorMatrix: Self = Self(spa_sys::SPA_FORMAT_VIDEO_colorMatrix);
    /// /Id enum spa_video_transfer_function)
    pub const VideoTransferFunction: Self = Self(spa_sys::SPA_FORMAT_VIDEO_transferFunction);
    ///  /Id enum spa_video_color_primaries)
    pub const VideoColorPrimaries: Self = Self(spa_sys::SPA_FORMAT_VIDEO_colorPrimaries);
    /// (Int)
    pub const VideoProfile: Self = Self(spa_sys::SPA_FORMAT_VIDEO_profile);
    /// (Int)
    pub const VideoLevel: Self = Self(spa_sys::SPA_FORMAT_VIDEO_level);
    /// (Id enum spa_h264_stream_format)
    pub const VideoH264StreamFormat: Self = Self(spa_sys::SPA_FORMAT_VIDEO_H264_streamFormat);
    /// (Id enum spa_h264_alignment)
    pub const VideoH264Alignment: Self = Self(spa_sys::SPA_FORMAT_VIDEO_H264_alignment);

    const AUDIO_RANGE: Range<Self> = Self::AudioFormat..Self(spa_sys::SPA_FORMAT_START_Video);
    const VIDEO_RANGE: Range<Self> = Self::VideoFormat..Self(spa_sys::SPA_FORMAT_START_Image);
    const IMAGE_RANGE: Range<Self> =
        Self(spa_sys::SPA_FORMAT_START_Image)..Self(spa_sys::SPA_FORMAT_START_Binary);
    const BINARY_RANGE: Range<Self> =
        Self(spa_sys::SPA_FORMAT_START_Binary)..Self(spa_sys::SPA_FORMAT_START_Stream);
    const STREAM_RANGE: Range<Self> =
        Self(spa_sys::SPA_FORMAT_START_Stream)..Self(spa_sys::SPA_FORMAT_START_Application);
    const APPLICATION_RANGE: Range<Self> =
        Self(spa_sys::SPA_FORMAT_START_Application)..Self(spa_sys::spa_format::MAX);

    pub fn is_audio(&self) -> bool {
        Self::AUDIO_RANGE.contains(self)
    }

    pub fn is_video(&self) -> bool {
        Self::VIDEO_RANGE.contains(self)
    }

    pub fn is_image(&self) -> bool {
        Self::IMAGE_RANGE.contains(self)
    }

    pub fn is_binary(&self) -> bool {
        Self::BINARY_RANGE.contains(self)
    }

    pub fn is_stream(&self) -> bool {
        Self::STREAM_RANGE.contains(self)
    }

    pub fn is_application(&self) -> bool {
        Self::APPLICATION_RANGE.contains(self)
    }

    /// Obtain a [`FormatProperties`] from a raw `spa_format` variant.
    pub fn from_raw(raw: spa_sys::spa_format) -> Self {
        Self(raw)
    }

    /// Get the raw [`spa_sys::spa_format`] representing this `FormatProperties`.
    pub fn as_raw(&self) -> spa_sys::spa_format {
        self.0
    }
}

impl Debug for FormatProperties {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let c_str = unsafe {
            let c_buf = spa_sys::spa_debug_type_find_name(spa_sys::spa_type_format, self.as_raw());
            if c_buf.is_null() {
                return f.write_str("Unsupported format");
            }
            CStr::from_ptr(c_buf)
        };
        let name = format!(
            "FormatProperties::{}",
            c_str
                .to_string_lossy()
                .replace("Spa:Pod:Object:Param:Format:", "")
                .replace(':', " ")
                .to_case(Case::Pascal)
        );
        f.write_str(&name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg_attr(miri, ignore)]
    fn debug_format() {
        assert_eq!("MediaType::Audio", format!("{:?}", MediaType::Audio));
        assert_eq!("MediaSubtype::Raw", format!("{:?}", MediaSubtype::Raw));
        assert_eq!(
            "FormatProperties::VideoTransferFunction",
            format!("{:?}", FormatProperties::VideoTransferFunction)
        );
    }
}
