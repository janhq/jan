// Copyright The pipewire-rs Contributors.
// SPDX-License-Identifier: MIT

use std::mem::MaybeUninit;

use crate::{
    param::format::{MediaSubtype, MediaType},
    pod::Pod,
    utils::result::{Error, SpaResult},
};

/// helper function to parse format properties type
pub fn parse_format(format: &Pod) -> Result<(MediaType, MediaSubtype), Error> {
    let mut media_type: MaybeUninit<u32> = MaybeUninit::uninit();
    let mut media_subtype: MaybeUninit<u32> = MaybeUninit::uninit();

    let res = unsafe {
        spa_sys::spa_format_parse(
            format.as_raw_ptr(),
            media_type.as_mut_ptr(),
            media_subtype.as_mut_ptr(),
        )
    };

    match SpaResult::from_c(res).into_sync_result() {
        Err(e) => Err(e),
        Ok(_) => Ok(unsafe {
            (
                MediaType::from_raw(media_type.assume_init()),
                MediaSubtype::from_raw(media_subtype.assume_init()),
            )
        }),
    }
}
