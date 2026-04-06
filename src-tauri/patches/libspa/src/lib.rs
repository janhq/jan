// Copyright The pipewire-rs Contributors.
// SPDX-License-Identifier: MIT

//! The `libspa` crate provides a high-level API to interact with
//! [libspa].
//!
//! [libspa]: https://docs.pipewire.org/page_spa.html

pub mod buffer;
pub mod param;
pub mod pod;
pub mod support;
pub mod utils;

pub use spa_sys as sys;
