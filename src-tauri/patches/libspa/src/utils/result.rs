// Copyright The pipewire-rs Contributors.
// SPDX-License-Identifier: MIT

//! SPA results and errors.

use std::{convert::TryInto, fmt};

use nix::errno::Errno;

/// A result returned by a SPA method, usually to be converted to
/// a Rust result using [`SpaResult::into_result`] or [`SpaResult::into_async_result`].
#[derive(Debug, Eq, PartialEq)]
pub struct SpaResult(i32);

/// An asynchronous sequence number returned by a SPA component.
///
/// Use [`AsyncSeq::seq`] to retrieve the actual sequence number.
#[derive(PartialEq, Eq, Copy, Clone)]
pub struct AsyncSeq(i32);

/// A successful result from a SPA method.
#[derive(Debug, Eq, PartialEq)]
pub enum SpaSuccess {
    /// Synchronous success
    Sync(i32),
    /// Asynchronous success
    Async(AsyncSeq),
}

fn async_seq(res: i32) -> i32 {
    let mask: i32 = spa_sys::SPA_ASYNC_SEQ_MASK.try_into().unwrap();
    res & mask
}

fn is_async(val: i32) -> bool {
    let bit: i32 = spa_sys::SPA_ASYNC_BIT.try_into().unwrap();
    (val & spa_sys::SPA_ASYNC_MASK) == bit
}

impl AsyncSeq {
    /// The sequence number
    pub fn seq(&self) -> i32 {
        async_seq(self.0)
    }

    /// The raw value, this is the sequence number with the `SPA_ASYNC_BIT` bit set
    pub fn raw(&self) -> i32 {
        self.0
    }

    /// Create a new [`AsyncSeq`] from a sequence number
    pub fn from_seq(seq: i32) -> Self {
        let bit: i32 = spa_sys::SPA_ASYNC_BIT.try_into().unwrap();
        let res = bit | async_seq(seq);

        Self(res)
    }

    /// Create a new [`AsyncSeq`] from a raw value having the `SPA_ASYNC_BIT` bit set
    pub fn from_raw(val: i32) -> Self {
        debug_assert!(is_async(val));
        Self(val)
    }
}

impl fmt::Debug for AsyncSeq {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "AsyncSeq seq: {} raw: {}", &self.seq(), &self.raw())
    }
}

impl SpaResult {
    /// Create a new [`SpaResult`] from an `i32` returned by C SPA method.
    pub fn from_c(res: i32) -> Self {
        Self(res)
    }

    /// Pending return for async operation identified with sequence number `seq`.
    pub fn new_return_async(seq: i32) -> Self {
        let seq = AsyncSeq::from_seq(seq);
        Self::from_c(seq.raw())
    }

    fn is_async(&self) -> bool {
        is_async(self.0)
    }

    /// Convert a [`SpaResult`] into a [`Result`]
    pub fn into_result(self) -> Result<SpaSuccess, Error> {
        if self.0 < 0 {
            Err(Error::new(-self.0))
        } else if self.is_async() {
            Ok(SpaSuccess::Async(AsyncSeq::from_raw(self.0)))
        } else {
            Ok(SpaSuccess::Sync(self.0))
        }
    }

    /// Convert a [`SpaResult`] into either an [`AsyncSeq`] or an [`Error`].
    ///
    /// # Panics
    ///
    /// This method will panic if the result is a synchronous success.
    pub fn into_async_result(self) -> Result<AsyncSeq, Error> {
        let res = self.into_result()?;

        match res {
            SpaSuccess::Async(res) => Ok(res),
            SpaSuccess::Sync(_) => panic!("result is synchronous success"),
        }
    }

    /// Convert a [`SpaResult`] into either a synchronous success or an [`Error`].
    ///
    /// # Panics
    ///
    /// This method will panic if the result is an asynchronous success.
    pub fn into_sync_result(self) -> Result<i32, Error> {
        let res = self.into_result()?;

        match res {
            SpaSuccess::Sync(res) => Ok(res),
            SpaSuccess::Async(_) => panic!("result is an asynchronous success"),
        }
    }
}

/// Error returned from a SPA method.
#[derive(Debug, Eq, PartialEq)]
pub struct Error(Errno);

impl Error {
    fn new(e: i32) -> Self {
        assert!(e > 0);

        Self(Errno::from_raw(e))
    }
}

impl std::error::Error for Error {}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg_attr(miri, ignore)]
    /* the errno crate is calling foreign function __xpg_strerror_r which is not supported by miri */
    fn spa_result() {
        assert!(!SpaResult::from_c(0).is_async());
        assert!(SpaResult::new_return_async(0).is_async());
        assert_eq!(
            SpaResult::new_return_async(0).into_async_result(),
            Ok(AsyncSeq::from_seq(0))
        );

        assert_eq!(SpaResult::from_c(0).into_result(), Ok(SpaSuccess::Sync(0)));
        assert_eq!(SpaResult::from_c(1).into_result(), Ok(SpaSuccess::Sync(1)));
        assert_eq!(SpaResult::from_c(0).into_sync_result(), Ok(0));

        assert_eq!(
            SpaResult::new_return_async(1).into_result(),
            Ok(SpaSuccess::Async(AsyncSeq::from_seq(1)))
        );

        let err = SpaResult::from_c(-libc::EBUSY).into_result().unwrap_err();
        assert_eq!(format!("{}", err), "EBUSY: Device or resource busy",);

        let res = SpaResult::from_c(-1).into_sync_result();
        assert!(res.is_err());
    }

    #[test]
    fn async_seq() {
        assert_eq!(AsyncSeq::from_seq(0).seq(), 0);
        assert_eq!(AsyncSeq::from_seq(1).seq(), 1);
    }

    #[should_panic]
    #[test]
    fn async_seq_panic() {
        // raw value does not have the SPA_ASYNC_BIT set
        AsyncSeq::from_raw(1);
    }

    #[should_panic]
    #[test]
    fn spa_async_result_panic() {
        let _ = SpaResult::from_c(0).into_async_result();
    }

    #[should_panic]
    #[test]
    fn spa_sync_result_panic() {
        let _ = SpaResult::new_return_async(10).into_sync_result();
    }
}
