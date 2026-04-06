// Copyright The pipewire-rs Contributors.
// SPDX-License-Identifier: MIT

use crate::utils::{
    result::{Error, SpaResult, SpaSuccess},
    Fraction, Rectangle,
};

#[cfg(feature = "v0_3_65")]
use convert_case::{Case, Casing};

use std::{ffi::CStr, fmt::Debug};

#[derive(Copy, Clone, PartialEq, Eq)]
pub struct VideoFormat(pub spa_sys::spa_video_format);

#[allow(non_upper_case_globals)]
impl VideoFormat {
    pub const Unknown: Self = Self(spa_sys::SPA_VIDEO_FORMAT_UNKNOWN);
    pub const Encoded: Self = Self(spa_sys::SPA_VIDEO_FORMAT_ENCODED);

    pub const I420: Self = Self(spa_sys::SPA_VIDEO_FORMAT_I420);
    pub const YV12: Self = Self(spa_sys::SPA_VIDEO_FORMAT_YV12);
    pub const YUY2: Self = Self(spa_sys::SPA_VIDEO_FORMAT_YUY2);
    pub const UYVY: Self = Self(spa_sys::SPA_VIDEO_FORMAT_UYVY);
    pub const AYUV: Self = Self(spa_sys::SPA_VIDEO_FORMAT_AYUV);
    pub const RGBx: Self = Self(spa_sys::SPA_VIDEO_FORMAT_RGBx);
    pub const BGRx: Self = Self(spa_sys::SPA_VIDEO_FORMAT_BGRx);
    pub const xRGB: Self = Self(spa_sys::SPA_VIDEO_FORMAT_xRGB);
    pub const xBGR: Self = Self(spa_sys::SPA_VIDEO_FORMAT_xBGR);
    pub const RGBA: Self = Self(spa_sys::SPA_VIDEO_FORMAT_RGBA);
    pub const BGRA: Self = Self(spa_sys::SPA_VIDEO_FORMAT_BGRA);
    pub const ARGB: Self = Self(spa_sys::SPA_VIDEO_FORMAT_ARGB);
    pub const ABGR: Self = Self(spa_sys::SPA_VIDEO_FORMAT_ABGR);
    pub const RGB: Self = Self(spa_sys::SPA_VIDEO_FORMAT_RGB);
    pub const BGR: Self = Self(spa_sys::SPA_VIDEO_FORMAT_BGR);
    pub const Y41B: Self = Self(spa_sys::SPA_VIDEO_FORMAT_Y41B);
    pub const Y42B: Self = Self(spa_sys::SPA_VIDEO_FORMAT_Y42B);
    pub const YVYU: Self = Self(spa_sys::SPA_VIDEO_FORMAT_YVYU);
    pub const Y444: Self = Self(spa_sys::SPA_VIDEO_FORMAT_Y444);
    pub const v210: Self = Self(spa_sys::SPA_VIDEO_FORMAT_v210);
    pub const v216: Self = Self(spa_sys::SPA_VIDEO_FORMAT_v216);
    pub const NV12: Self = Self(spa_sys::SPA_VIDEO_FORMAT_NV12);
    pub const NV21: Self = Self(spa_sys::SPA_VIDEO_FORMAT_NV21);
    pub const GRAY8: Self = Self(spa_sys::SPA_VIDEO_FORMAT_GRAY8);
    pub const GRAY16_BE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_GRAY16_BE);
    pub const GRAY16_LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_GRAY16_LE);
    pub const v308: Self = Self(spa_sys::SPA_VIDEO_FORMAT_v308);
    pub const RGB16: Self = Self(spa_sys::SPA_VIDEO_FORMAT_RGB16);
    pub const BGR16: Self = Self(spa_sys::SPA_VIDEO_FORMAT_BGR16);
    pub const RGB15: Self = Self(spa_sys::SPA_VIDEO_FORMAT_RGB15);
    pub const BGR15: Self = Self(spa_sys::SPA_VIDEO_FORMAT_BGR15);
    pub const UYVP: Self = Self(spa_sys::SPA_VIDEO_FORMAT_UYVP);
    pub const A420: Self = Self(spa_sys::SPA_VIDEO_FORMAT_A420);
    pub const RGB8P: Self = Self(spa_sys::SPA_VIDEO_FORMAT_RGB8P);
    pub const YUV9: Self = Self(spa_sys::SPA_VIDEO_FORMAT_YUV9);
    pub const YVU9: Self = Self(spa_sys::SPA_VIDEO_FORMAT_YVU9);
    pub const IYU1: Self = Self(spa_sys::SPA_VIDEO_FORMAT_IYU1);
    pub const ARGB64: Self = Self(spa_sys::SPA_VIDEO_FORMAT_ARGB64);
    pub const AYUV64: Self = Self(spa_sys::SPA_VIDEO_FORMAT_AYUV64);
    pub const r210: Self = Self(spa_sys::SPA_VIDEO_FORMAT_r210);
    pub const I420_10BE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_I420_10BE);
    pub const I420_10LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_I420_10LE);
    pub const I422_10BE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_I422_10BE);
    pub const I422_10LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_I422_10LE);
    pub const Y444_10BE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_Y444_10BE);
    pub const Y444_10LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_Y444_10LE);
    pub const GBR: Self = Self(spa_sys::SPA_VIDEO_FORMAT_GBR);
    pub const GBR_10BE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_GBR_10BE);
    pub const GBR_10LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_GBR_10LE);
    pub const NV16: Self = Self(spa_sys::SPA_VIDEO_FORMAT_NV16);
    pub const NV24: Self = Self(spa_sys::SPA_VIDEO_FORMAT_NV24);
    pub const NV12_64Z32: Self = Self(spa_sys::SPA_VIDEO_FORMAT_NV12_64Z32);
    pub const A420_10BE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_A420_10BE);
    pub const A420_10LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_A420_10LE);
    pub const A422_10BE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_A422_10BE);
    pub const A422_10LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_A422_10LE);
    pub const A444_10BE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_A444_10BE);
    pub const A444_10LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_A444_10LE);
    pub const NV61: Self = Self(spa_sys::SPA_VIDEO_FORMAT_NV61);
    pub const P010_10BE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_P010_10BE);
    pub const P010_10LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_P010_10LE);
    pub const IYU2: Self = Self(spa_sys::SPA_VIDEO_FORMAT_IYU2);
    pub const VYUY: Self = Self(spa_sys::SPA_VIDEO_FORMAT_VYUY);
    pub const GBRA: Self = Self(spa_sys::SPA_VIDEO_FORMAT_GBRA);
    pub const GBRA_10BE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_GBRA_10BE);
    pub const GBRA_10LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_GBRA_10LE);
    pub const GBR_12BE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_GBR_12BE);
    pub const GBR_12LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_GBR_12LE);
    pub const GBRA_12BE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_GBRA_12BE);
    pub const GBRA_12LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_GBRA_12LE);
    pub const I420_12BE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_I420_12BE);
    pub const I420_12LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_I420_12LE);
    pub const I422_12BE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_I422_12BE);
    pub const I422_12LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_I422_12LE);
    pub const Y444_12BE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_Y444_12BE);
    pub const Y444_12LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_Y444_12LE);

    pub const RGBA_F16: Self = Self(spa_sys::SPA_VIDEO_FORMAT_RGBA_F16);
    pub const RGBA_F32: Self = Self(spa_sys::SPA_VIDEO_FORMAT_RGBA_F32);

    /// 32-bit x:R:G:B 2:10:10:10 little endian
    pub const xRGB_210LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_xRGB_210LE);
    ///32-bit x:B:G:R 2:10:10:10 little endian
    pub const xBGR_210LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_xBGR_210LE);
    ///32-bit R:G:B:x 10:10:10:2 little endian
    pub const RGBx_102LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_RGBx_102LE);
    /// 32-bit B:G:R:x 10:10:10:2 little endian
    pub const BGRx_102LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_BGRx_102LE);
    /// 32-bit A:R:G:B 2:10:10:10 little endian
    pub const ARGB_210LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_ARGB_210LE);
    /// 32-bit A:B:G:R 2:10:10:10 little endian
    pub const ABGR_210LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_ABGR_210LE);
    /// 32-bit R:G:B:A 10:10:10:2 little endian
    pub const RGBA_102LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_RGBA_102LE);
    /// 32-bit B:G:R:A 10:10:10:2 little endian
    pub const BGRA_102LE: Self = Self(spa_sys::SPA_VIDEO_FORMAT_BGRA_102LE);

    /* Aliases */
    pub const DSP_F32: Self = Self(spa_sys::SPA_VIDEO_FORMAT_DSP_F32);

    /// Obtain a [`VideoFormat`] from a raw `spa_video_format` variant.
    pub fn from_raw(raw: spa_sys::spa_video_format) -> Self {
        Self(raw)
    }

    /// Get the raw [`spa_sys::spa_video_format`] representing this `VideoFormat`.
    pub fn as_raw(&self) -> spa_sys::spa_video_format {
        self.0
    }
}

impl Debug for VideoFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match *self {
            VideoFormat::Unknown => f.write_str("VideoFormat::Unknown"),
            _ => {
                let c_str = unsafe {
                    let c_buf = spa_sys::spa_debug_type_find_short_name(
                        spa_sys::spa_type_video_format,
                        self.as_raw(),
                    );
                    if c_buf.is_null() {
                        return f.write_str("Unsupported");
                    }
                    CStr::from_ptr(c_buf)
                };
                let name = format!("VideoFormat::{}", c_str.to_string_lossy());
                f.write_str(&name)
            }
        }
    }
}

bitflags::bitflags! {
    #[derive(Debug, PartialEq, Eq, Clone, Copy)]
    pub struct VideoFlags: u32 {
        /// no flags
        const NONE = spa_sys::SPA_VIDEO_FLAG_NONE;
        /// a variable fps is selected, fps_n and fps_d denote the maximum fps of the video
        const VARIABLE_FPS = spa_sys::SPA_VIDEO_FLAG_VARIABLE_FPS;
        /// Each color has been scaled by the alpha value.
        const PREMULTIPLIED_ALPHA = spa_sys::SPA_VIDEO_FLAG_PREMULTIPLIED_ALPHA;
        /// use the format modifier
        #[cfg(feature = "v0_3_65")]
        const MODIFIER = spa_sys::SPA_VIDEO_FLAG_MODIFIER;
        #[cfg(feature = "v0_3_75")]
        /// format modifier was not fixated yet
        const MODIFIER_FIXATION_REQUIRED = spa_sys::SPA_VIDEO_FLAG_MODIFIER_FIXATION_REQUIRED;
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub struct VideoInterlaceMode(pub spa_sys::spa_video_interlace_mode);

#[allow(non_upper_case_globals)]
impl VideoInterlaceMode {
    /// all frames are progressive
    pub const Progressive: Self = Self(spa_sys::SPA_VIDEO_INTERLACE_MODE_PROGRESSIVE);
    /// 2 fields are interleaved in one video frame.
    /// Extra buffer flags describe the field order.
    pub const Interleaved: Self = Self(spa_sys::SPA_VIDEO_INTERLACE_MODE_INTERLEAVED);
    /// frames contains both interlaced and progressive video, the buffer flags describe the frame fields.
    pub const Mixed: Self = Self(spa_sys::SPA_VIDEO_INTERLACE_MODE_MIXED);
    /// 2 fields are stored in one buffer, use the frame ID to get access to the required field. For multiview (the 'views'
    /// property > 1) the fields of view N can be found at frame ID (N * 2) and (N * 2) + 1. Each field has only half the
    /// amount of lines as noted in the height property. This mode requires multiple spa_data to describe the fields.
    pub const Fields: Self = Self(spa_sys::SPA_VIDEO_INTERLACE_MODE_FIELDS);

    /// Obtain a [`VideoInterlaceMode`] from a raw `spa_video_interlace_mode` variant.
    pub fn from_raw(raw: spa_sys::spa_video_interlace_mode) -> Self {
        Self(raw)
    }

    /// Get the raw [`spa_sys::spa_video_interlace_mode`] representing this `VideoInterlaceMode`.
    pub fn as_raw(&self) -> spa_sys::spa_video_interlace_mode {
        self.0
    }
}

#[cfg(feature = "v0_3_65")]
impl Debug for VideoInterlaceMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let c_str = unsafe {
            let c_buf = spa_sys::spa_debug_type_find_short_name(
                spa_sys::spa_type_video_interlace_mode,
                self.as_raw(),
            );
            if c_buf.is_null() {
                return f.write_str("Unsupported");
            }
            CStr::from_ptr(c_buf)
        };
        let name = format!(
            "VideoInterlaceMode::{}",
            c_str.to_string_lossy().to_case(Case::Pascal)
        );
        f.write_str(&name)
    }
}

/// Rust representation of [`spa_sys::spa_video_info_raw`].
#[repr(transparent)]
#[derive(PartialEq, Eq, Clone, Copy)]
pub struct VideoInfoRaw(spa_sys::spa_video_info_raw);

impl VideoInfoRaw {
    pub fn new() -> Self {
        // Zero-initialize so we stay compatible with both older and newer `spa_video_info_raw`
        // layouts from libspa-sys bindgen (field order/count differs across PipeWire versions).
        let mut s = Self(unsafe { std::mem::zeroed() });
        s.set_format(VideoFormat::Unknown);
        s
    }

    pub fn set_format(&mut self, format: VideoFormat) {
        self.0.format = format.as_raw();
    }

    pub fn format(self) -> VideoFormat {
        VideoFormat::from_raw(self.0.format)
    }

    pub fn set_flags(&mut self, _flags: VideoFlags) {
        // Newer PipeWire drops `flags` from `spa_video_info_raw`; bindgen then has no `flags` field.
    }

    pub fn flags(self) -> VideoFlags {
        VideoFlags::from_bits_retain(0)
    }

    pub fn set_modifier(&mut self, modifier: u64) {
        self.0.modifier = modifier as _;
    }

    pub fn modifier(self) -> u64 {
        self.0.modifier as _
    }

    pub fn set_size(&mut self, size: Rectangle) {
        self.0.size = size;
    }

    pub fn size(self) -> Rectangle {
        self.0.size
    }

    pub fn set_framerate(&mut self, framerate: Fraction) {
        self.0.framerate = framerate;
    }

    pub fn framerate(self) -> Fraction {
        self.0.framerate
    }

    pub fn set_max_framerate(&mut self, max_framerate: Fraction) {
        self.0.max_framerate = max_framerate;
    }

    pub fn max_framerate(self) -> Fraction {
        self.0.max_framerate
    }

    pub fn set_views(&mut self, views: u32) {
        self.0.views = views as _;
    }

    pub fn views(self) -> u32 {
        self.0.views as _
    }

    pub fn set_interlace_mode(&mut self, interlace_mode: VideoInterlaceMode) {
        self.0.interlace_mode = interlace_mode.as_raw();
    }

    pub fn interlace_mode(self) -> VideoInterlaceMode {
        VideoInterlaceMode::from_raw(self.0.interlace_mode)
    }

    pub fn set_pixel_aspect_ratio(&mut self, pixel_aspect_ratio: Fraction) {
        self.0.pixel_aspect_ratio = pixel_aspect_ratio;
    }

    pub fn pixel_aspect_ratio(self) -> Fraction {
        self.0.pixel_aspect_ratio
    }

    pub fn set_multiview_mode(&mut self, multiview_mode: i32) {
        self.0.multiview_mode = multiview_mode as _;
    }

    pub fn multiview_mode(self) -> i32 {
        self.0.multiview_mode as _
    }

    pub fn set_multiview_flags(&mut self, multiview_flags: u32) {
        self.0.multiview_flags = multiview_flags as _;
    }

    pub fn multiview_flags(self) -> u32 {
        self.0.multiview_flags as _
    }

    pub fn set_chroma_site(&mut self, chroma_site: u32) {
        self.0.chroma_site = chroma_site as _;
    }

    pub fn chroma_site(self) -> u32 {
        self.0.chroma_site as _
    }

    pub fn set_color_range(&mut self, color_range: u32) {
        self.0.color_range = color_range as _;
    }

    pub fn color_range(self) -> u32 {
        self.0.color_range as _
    }

    pub fn set_color_matrix(&mut self, color_matrix: u32) {
        self.0.color_matrix = color_matrix as _;
    }

    pub fn color_matrix(self) -> u32 {
        self.0.color_matrix as _
    }

    pub fn set_transfer_function(&mut self, transfer_function: u32) {
        self.0.transfer_function = transfer_function as _;
    }

    pub fn transfer_function(self) -> u32 {
        self.0.transfer_function as _
    }

    pub fn set_color_primaries(&mut self, color_primaries: u32) {
        self.0.color_primaries = color_primaries as _;
    }

    pub fn color_primaries(self) -> u32 {
        self.0.color_primaries as _
    }

    /// helper function to parse format properties type
    pub fn parse(&mut self, format: &crate::pod::Pod) -> Result<SpaSuccess, Error> {
        let res = unsafe { spa_sys::spa_format_video_raw_parse(format.as_raw_ptr(), &mut self.0) };
        SpaResult::from_c(res).into_result()
    }

    /// Obtain a [`VideoInfoRaw`] from a raw `spa_video_info_raw` variant.
    pub fn from_raw(raw: spa_sys::spa_video_info_raw) -> Self {
        Self(raw)
    }

    /// Get the raw [`spa_sys::spa_video_info_raw`] representing this `VideoInfoRaw`.
    pub fn as_raw(&self) -> spa_sys::spa_video_info_raw {
        self.0
    }
}

impl Default for VideoInfoRaw {
    fn default() -> Self {
        Self::new()
    }
}

impl Debug for VideoInfoRaw {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        #[cfg(feature = "v0_3_65")]
        let interlace_mode = self.interlace_mode();
        #[cfg(not(feature = "v0_3_65"))]
        let interlace_mode = self.interlace_mode().as_raw();

        f.debug_struct("VideoInfoRaw")
            .field("format", &self.format())
            .field("flags", &self.flags())
            .field("modifier", &self.modifier())
            .field("size", &self.size())
            .field("framerate", &self.framerate())
            .field("max_framerate", &self.max_framerate())
            .field("views", &self.views())
            .field("interlace_mode", &interlace_mode)
            .field("pixel_aspect_ratio", &self.pixel_aspect_ratio())
            .field("multiview_mode", &self.multiview_mode())
            .field("multiview_flags", &self.multiview_flags())
            .field("chroma_site", &self.chroma_site())
            .field("color_range", &self.color_range())
            .field("color_matrix", &self.color_matrix())
            .field("transfer_function", &self.transfer_function())
            .field("color_primaries", &self.color_primaries())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg_attr(miri, ignore)]
    fn debug_format() {
        assert_eq!(
            "VideoFormat::Unknown",
            format!("{:?}", VideoFormat::Unknown)
        );
        assert_eq!("VideoFormat::YV12", format!("{:?}", VideoFormat::YV12));
        assert_eq!("VideoFormat::RGBx", format!("{:?}", VideoFormat::RGBx));
        assert_eq!("VideoFormat::xRGB", format!("{:?}", VideoFormat::xRGB));
        assert_eq!(
            "VideoFormat::GRAY16_BE",
            format!("{:?}", VideoFormat::GRAY16_BE)
        );
        assert_eq!(
            "VideoFormat::xRGB_210LE",
            format!("{:?}", VideoFormat::xRGB_210LE)
        );
        #[cfg(feature = "v0_3_65")]
        assert_eq!(
            "VideoInterlaceMode::Progressive",
            format!("{:?}", VideoInterlaceMode::Progressive)
        );
    }
}
