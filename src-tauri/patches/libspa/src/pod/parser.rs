// Copyright The pipewire-rs Contributors.
// SPDX-License-Identifier: MIT

use std::{
    ffi::{c_char, c_double, c_float, c_void, CStr},
    marker::PhantomData,
    mem::MaybeUninit,
};

use nix::errno::Errno;

use crate::utils::{Fraction, Id, Rectangle};

/// Low-level wrapper around `spa_pod_parser`.
///
/// Using this may require using `unsafe` and/or working with C types, but
/// is still more safe and rusty than the raw functions and types.
#[repr(transparent)]
pub struct Parser<'d> {
    parser: spa_sys::spa_pod_parser,
    data: PhantomData<&'d [u8]>,
}

impl<'d> Parser<'d> {
    pub fn new(data: &'d [u8]) -> Self {
        unsafe {
            let mut parser: MaybeUninit<spa_sys::spa_pod_parser> = MaybeUninit::uninit();
            spa_sys::spa_pod_parser_init(
                parser.as_mut_ptr(),
                data.as_ptr().cast(),
                data.len()
                    .try_into()
                    .expect("data length does not fit in a u32"),
            );
            Self {
                parser: parser.assume_init(),
                data: PhantomData,
            }
        }
    }

    pub fn from_pod(pod: &'d crate::pod::Pod) -> Self {
        unsafe {
            let mut parser: MaybeUninit<spa_sys::spa_pod_parser> = MaybeUninit::uninit();
            spa_sys::spa_pod_parser_pod(parser.as_mut_ptr(), pod.as_raw_ptr());
            Self {
                parser: parser.assume_init(),
                data: PhantomData,
            }
        }
    }

    pub fn as_raw(&self) -> &spa_sys::spa_pod_parser {
        &self.parser
    }

    pub fn as_raw_ptr(&self) -> *mut spa_sys::spa_pod_parser {
        std::ptr::addr_of!(self.parser).cast_mut()
    }

    pub fn into_raw(self) -> spa_sys::spa_pod_parser {
        self.parser
    }

    /// # Safety
    ///
    /// The parser state may only be used as long as all frames that were pushed
    /// to the parser at the time of this call are alive and not moved
    pub unsafe fn state(&self) -> spa_sys::spa_pod_parser_state {
        let mut state: MaybeUninit<spa_sys::spa_pod_parser_state> = MaybeUninit::uninit();
        spa_sys::spa_pod_parser_get_state(self.as_raw_ptr(), state.as_mut_ptr());
        state.assume_init()
    }

    /// # Safety
    ///
    /// TODO: Constraints unknown, use at own risk
    pub unsafe fn reset(&mut self, state: *mut spa_sys::spa_pod_parser_state) {
        spa_sys::spa_pod_parser_reset(self.as_raw_ptr(), state)
    }

    /// # Safety
    ///
    /// TODO: Constraints unknown, use at own risk
    pub unsafe fn deref(&mut self, offset: u32, size: u32) -> *mut spa_sys::spa_pod {
        spa_sys::spa_pod_parser_deref(self.as_raw_ptr(), offset, size)
    }

    /// # Safety
    ///
    /// TODO: Constraints unknown, use at own risk
    pub unsafe fn frame(&mut self, frame: *mut spa_sys::spa_pod_frame) -> *mut spa_sys::spa_pod {
        spa_sys::spa_pod_parser_frame(self.as_raw_ptr(), frame)
    }

    /// # Safety
    ///
    /// TODO: Constraints unknown, use at own risk
    pub unsafe fn push(
        &mut self,
        frame: *mut spa_sys::spa_pod_frame,
        pod: *const spa_sys::spa_pod,
        offset: u32,
    ) {
        spa_sys::spa_pod_parser_push(self.as_raw_ptr(), frame, pod, offset)
    }

    pub fn current(&mut self) -> *mut spa_sys::spa_pod {
        unsafe { spa_sys::spa_pod_parser_current(self.as_raw_ptr()) }
    }

    /// # Safety
    ///
    /// Pod pointed to must we valid, well aligned, and contained in the current frame
    ///
    /// TODO: Any other constraints? Use at own risk
    pub unsafe fn advance(&mut self, pod: *const spa_sys::spa_pod) {
        spa_sys::spa_pod_parser_advance(self.as_raw_ptr(), pod)
    }

    /// # Safety
    ///
    /// TODO: Constraints unknown, use at own risk
    pub unsafe fn next(&mut self) -> *mut spa_sys::spa_pod {
        spa_sys::spa_pod_parser_next(self.as_raw_ptr())
    }

    /// # Safety
    ///
    /// Only the last added frame may be popped
    pub unsafe fn pop(&mut self, frame: &mut spa_sys::spa_pod_frame) -> Result<(), Errno> {
        let res = spa_sys::spa_pod_parser_pop(self.as_raw_ptr(), frame as *mut _);

        if res >= 0 {
            Ok(())
        } else {
            Err(Errno::from_raw(-res))
        }
    }

    pub fn get_bool(&mut self) -> Result<bool, Errno> {
        unsafe {
            let mut b: MaybeUninit<bool> = MaybeUninit::uninit();
            let res = spa_sys::spa_pod_parser_get_bool(self.as_raw_ptr(), b.as_mut_ptr());
            if res >= 0 {
                Ok(b.assume_init())
            } else {
                Err(Errno::from_raw(-res))
            }
        }
    }

    pub fn get_id(&mut self) -> Result<Id, Errno> {
        unsafe {
            let mut id: MaybeUninit<u32> = MaybeUninit::uninit();
            let res = spa_sys::spa_pod_parser_get_id(self.as_raw_ptr(), id.as_mut_ptr());
            if res >= 0 {
                Ok(Id(id.assume_init()))
            } else {
                Err(Errno::from_raw(-res))
            }
        }
    }

    pub fn get_int(&mut self) -> Result<i32, Errno> {
        unsafe {
            let mut int: MaybeUninit<i32> = MaybeUninit::uninit();
            let res = spa_sys::spa_pod_parser_get_int(self.as_raw_ptr(), int.as_mut_ptr());
            if res >= 0 {
                Ok(int.assume_init())
            } else {
                Err(Errno::from_raw(-res))
            }
        }
    }

    pub fn get_long(&mut self) -> Result<i64, Errno> {
        unsafe {
            let mut long: MaybeUninit<i64> = MaybeUninit::uninit();
            let res = spa_sys::spa_pod_parser_get_long(self.as_raw_ptr(), long.as_mut_ptr());
            if res >= 0 {
                Ok(long.assume_init())
            } else {
                Err(Errno::from_raw(-res))
            }
        }
    }

    pub fn get_float(&mut self) -> Result<c_float, Errno> {
        unsafe {
            let mut float: MaybeUninit<c_float> = MaybeUninit::uninit();
            let res = spa_sys::spa_pod_parser_get_float(self.as_raw_ptr(), float.as_mut_ptr());
            if res >= 0 {
                Ok(float.assume_init())
            } else {
                Err(Errno::from_raw(-res))
            }
        }
    }

    pub fn get_double(&mut self) -> Result<c_double, Errno> {
        unsafe {
            let mut double: MaybeUninit<c_double> = MaybeUninit::uninit();
            let res = spa_sys::spa_pod_parser_get_double(self.as_raw_ptr(), double.as_mut_ptr());
            if res >= 0 {
                Ok(double.assume_init())
            } else {
                Err(Errno::from_raw(-res))
            }
        }
    }

    pub fn get_string_raw(&mut self) -> Result<&'d CStr, Errno> {
        unsafe {
            let mut string: MaybeUninit<*const c_char> = MaybeUninit::uninit();
            let res = spa_sys::spa_pod_parser_get_string(self.as_raw_ptr(), string.as_mut_ptr());
            if res >= 0 {
                let string = string.assume_init();
                // FIXME: Do we need to check string for null?
                let string = CStr::from_ptr(string);
                Ok(string)
            } else {
                Err(Errno::from_raw(-res))
            }
        }
    }

    pub fn get_bytes(&mut self) -> Result<&'d [u8], Errno> {
        unsafe {
            let mut bytes: MaybeUninit<*const u8> = MaybeUninit::uninit();
            let mut len: MaybeUninit<u32> = MaybeUninit::uninit();
            let res = spa_sys::spa_pod_parser_get_bytes(
                self.as_raw_ptr(),
                bytes.as_mut_ptr().cast(),
                len.as_mut_ptr(),
            );
            if res >= 0 {
                let bytes = bytes.assume_init();
                let len = len.assume_init();
                // TODO: Do we need to check bytes for null?
                let bytes = std::slice::from_raw_parts(bytes, len.try_into().unwrap());
                Ok(bytes)
            } else {
                Err(Errno::from_raw(-res))
            }
        }
    }

    pub fn get_pointer(&mut self) -> Result<(*const c_void, Id), Errno> {
        unsafe {
            let mut ptr: MaybeUninit<*const c_void> = MaybeUninit::uninit();
            let mut type_: MaybeUninit<u32> = MaybeUninit::uninit();
            let res = spa_sys::spa_pod_parser_get_pointer(
                self.as_raw_ptr(),
                type_.as_mut_ptr(),
                ptr.as_mut_ptr(),
            );
            if res >= 0 {
                Ok((ptr.assume_init(), Id(type_.assume_init())))
            } else {
                Err(Errno::from_raw(-res))
            }
        }
    }

    pub fn get_fd(&mut self) -> Result<i64, Errno> {
        unsafe {
            let mut fd: MaybeUninit<i64> = MaybeUninit::uninit();
            let res = spa_sys::spa_pod_parser_get_fd(self.as_raw_ptr(), fd.as_mut_ptr());
            if res >= 0 {
                Ok(fd.assume_init())
            } else {
                Err(Errno::from_raw(-res))
            }
        }
    }

    pub fn get_rectangle(&mut self) -> Result<Rectangle, Errno> {
        unsafe {
            let mut rect: MaybeUninit<spa_sys::spa_rectangle> = MaybeUninit::uninit();
            let res = spa_sys::spa_pod_parser_get_rectangle(self.as_raw_ptr(), rect.as_mut_ptr());
            if res >= 0 {
                Ok(rect.assume_init())
            } else {
                Err(Errno::from_raw(-res))
            }
        }
    }

    pub fn get_fraction(&mut self) -> Result<Fraction, Errno> {
        unsafe {
            let mut frac: MaybeUninit<spa_sys::spa_fraction> = MaybeUninit::uninit();
            let res = spa_sys::spa_pod_parser_get_fraction(self.as_raw_ptr(), frac.as_mut_ptr());
            if res >= 0 {
                Ok(frac.assume_init())
            } else {
                Err(Errno::from_raw(-res))
            }
        }
    }

    pub fn get_pod(&mut self) -> Result<&'d crate::pod::Pod, Errno> {
        unsafe {
            let mut pod: MaybeUninit<*mut spa_sys::spa_pod> = MaybeUninit::uninit();
            let res = spa_sys::spa_pod_parser_get_pod(self.as_raw_ptr(), pod.as_mut_ptr());
            if res >= 0 {
                // Safety:
                // spa_pod_parser_get_pod() guarantees that if res >= 0, then
                // the returned pod is valid and fits in the parsed memory slice.
                let pod = crate::pod::Pod::from_raw(pod.assume_init());

                Ok(pod)
            } else {
                Err(Errno::from_raw(-res))
            }
        }
    }

    /// # Safety
    /// The provided frame must not be moved or destroyed before it is popped again.
    ///
    /// The frame may only be assumed as initialized if this method returns `Ok`.
    pub unsafe fn push_struct(
        &mut self,
        frame: &mut MaybeUninit<spa_sys::spa_pod_frame>,
    ) -> Result<(), Errno> {
        let res = spa_sys::spa_pod_parser_push_struct(self.as_raw_ptr(), frame.as_mut_ptr());

        if res >= 0 {
            Ok(())
        } else {
            Err(Errno::from_raw(-res))
        }
    }

    /// # Safety
    /// The provided frame must not be moved or destroyed before it is popped again.
    ///
    /// The frame may only be assumed as initialized if this method returns `Ok`.
    pub unsafe fn push_object(
        &mut self,
        frame: &mut MaybeUninit<spa_sys::spa_pod_frame>,
        _type: u32,
    ) -> Result<Id, Errno> {
        let mut id: MaybeUninit<u32> = MaybeUninit::uninit();
        let res = spa_sys::spa_pod_parser_push_object(
            self.as_raw_ptr(),
            frame.as_mut_ptr(),
            _type,
            id.as_mut_ptr(),
        );

        if res >= 0 {
            Ok(Id(id.assume_init()))
        } else {
            Err(Errno::from_raw(-res))
        }
    }
}

/// Convenience macro to parse values from a spa pod using a spa pod parser.
///
/// For arguments, the macro accepts the parser, and then the structure of the desired pods:
///
/// ```ignore
/// parser_get!(<&mut libspa::pod::parser::Parser>, Bool(<&mut bool>));
/// parser_get!(<&mut libspa::pod::parser::Parser>, Id(<&mut libspa::utils::Id>));
/// parser_get!(<&mut libspa::pod::parser::Parser>, Int(<&mut i32>));
/// parser_get!(<&mut libspa::pod::parser::Parser>, Long(<&mut i64>));
/// parser_get!(<&mut libspa::pod::parser::Parser>, Float(<&mut f32>));
/// parser_get!(<&mut libspa::pod::parser::Parser>, Double(<&mut f64>));
/// parser_get!(<&mut libspa::pod::parser::Parser>, Bytes(<&mut &[u8]>));
/// parser_get!(<&mut libspa::pod::parser::Parser>, Pointer(<&mut *const c_void>));
/// parser_get!(<&mut libspa::pod::parser::Parser>, Fd(<&mut i64>));
/// parser_get!(<&mut libspa::pod::parser::Parser>, Rectangle(<&mut libspa::utils::Rectangle>));
/// parser_get!(<&mut libspa::pod::parser::Parser>, Fraction(<&mut libspa::utils::Fraction>));
/// parser_get!(<&mut libspa::pod::parser::Parser>, Pod(<&mut &libspa::pod::Pod>));
/// parser_get!(<&mut libspa::pod::parser::Parser>,
///     Struct {
///         // 0 to n fields, e.g.:
///         Struct {
///             Int(<&mut i32>),
///             Float(<&mut f32>),
///         },
///         Bytes(<&mut &[u8]),
///     }
/// );
/// ```
///
/// # Returns
///
/// The macro returns a `Result<(), Errno>`.
/// If parsing succeeds, an `Ok(())` is returned.
/// Otherwise, the `Err(Errno)` from the point where parsing failed is returned, and the rest of the values are not parsed.
#[macro_export]
macro_rules! __parser_get__ {
    ($parser:expr, Bool($val:expr)) => {
        {
            let val: &mut bool = $val;
            let res = $crate::pod::parser::Parser::get_bool($parser);
            if let Ok(bool) = res {
                *val = bool;
            }
            res.map(|_| {})
        }
    };
    ($parser:expr, Id($val:expr)) => {
        {
            let val: &mut $crate::utils::Id = $val;
            let res = $crate::pod::parser::Parser::get_id($parser);
            if let Ok(id) = res {
                *val = id;
            }
            res.map(|_| {})
        }
    };
    ($parser:expr, Int($val:expr)) => {
        {
            let val: &mut i32 = $val;
            let res = $crate::pod::parser::Parser::get_int($parser);
            if let Ok(int) = res {
                *val = int;
            }
            res.map(|_| {})
        }
    };
    ($parser:expr, Long($val:expr)) => {
        {
            let val: &mut i64 = $val;
            let res = $crate::pod::parser::Parser::get_long($parser);
            if let Ok(long) = res {
                *val = long;
            }
            res.map(|_| {})
        }
    };
    ($parser:expr, Float($val:expr)) => {
        {
            let val: &mut f32 = $val;
            let res = $crate::pod::parser::Parser::get_float($parser);
            if let Ok(float) = res {
                *val = float;
            }
            res.map(|_| {})
        }
    };
    ($parser:expr, Double($val:expr)) => {
        {
            let val: &mut f64 = $val;
            let res = $crate::pod::parser::Parser::get_double($parser);
            if let Ok(double) = res {
                *val = double;
            }
            res.map(|_| {})
        }
    };
    // TODO: String
    ($parser:expr, Bytes($val:expr)) => {
        {
            let val: &mut &[u8] = $val;
            let res = $crate::pod::parser::Parser::get_bytes($parser);
            if let Ok(bytes) = res {
                *val = bytes;
            }
            res.map(|_| {})
        }
    };
    ($parser:expr, Pointer($val:expr)) => {
        {
            let val: &mut (*const c_void, Id) = $val;
            let res = $crate::pod::parser::Parser::get_pointer($parser);
            if let Ok(ptr) = res {
                *val = ptr;
            }
            res.map(|_| {})
        }
    };
    ($parser:expr, Fd($val:expr)) => {
        {
            let val: &mut i64 = $val;
            let res = $crate::pod::parser::Parser::get_fd($parser);
            if let Ok(fd) = res {
                *val = fd;
            }
            res.map(|_| {})
        }
    };
    ($parser:expr, Rectangle($val:expr)) => {
        {
            let val: &mut $crate::utils::Rectangle = $val;
            let res = $crate::pod::parser::Parser::get_rectangle($parser);
            if let Ok(rect) = res {
                *val = rect;
            }
            res.map(|_| {})
        }
    };
    ($parser:expr, Fraction($val:expr)) => {
        {
            let val: &mut $crate::utils::Fraction = $val;
            let res = $crate::pod::parser::Parser::get_fraction($parser);
            if let Ok(fraction) = res {
                *val = fraction;
            }
            res.map(|_| {})
        }
    };
    ($parser:expr, Pod($val:expr)) => {
        {
            let val: &mut $crate::pod::Pod = $val;
            let res = $crate::pod::parser::Parser::get_pod($parser);
            if let Ok(pod) = res {
                *val = pod;
            }
            res.map(|_| {})
        }
    };
    ($parser:expr, Struct { $( $field_type:tt $field:tt ),* $(,)? }) => {
        'outer: {
            let mut frame: ::std::mem::MaybeUninit<$crate::sys::spa_pod_frame> = ::std::mem::MaybeUninit::uninit();
            let res = unsafe { $crate::pod::parser::Parser::push_struct($parser, &mut frame) };
            if res.is_err() {
                break 'outer res;
            }

            $(
                let res = $crate::__parser_get__!($parser, $field_type $field);
                if res.is_err() {
                    // Discard Ok variant value so we can assign to Result<(), Errno>
                    break 'outer res.map(|_| {});
                }
            )*

            unsafe { $crate::pod::parser::Parser::pop($parser, frame.assume_init_mut()) }
        }
    };
    // TODO: Object
    // TODO: ($parser:expr, Option( $type_:tt $val:tt )) or similar for optional values
}
pub use __parser_get__ as parser_get;

#[cfg(test)]
mod tests {
    use super::{parser_get, Parser};

    // FIXME: The way we construct raw pods here is rather crude and error-prone.
    //        Maybe replace it with the pod builder in the future, and share the tests with it.

    #[test]
    #[cfg_attr(miri, ignore)]
    fn parse_bool() {
        let pod: Vec<u8> = [
            &4u32.to_ne_bytes(), // bool body size
            &2u32.to_ne_bytes(), // bool type
            &1u32.to_ne_bytes(), // bool "true"
            &[0, 0, 0, 0],       // padding
        ]
        .into_iter()
        .flatten()
        .copied()
        .collect();

        let mut parser = Parser::new(&pod);
        let mut bool = false;

        let res = parser_get!(&mut parser, Bool(&mut bool));

        assert!(res.is_ok());
        assert!(bool);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn parse_empty_struct() {
        let pod: Vec<u8> = [
            &0u32.to_ne_bytes(),  // body size: 0 children => 0 bytes
            &14u32.to_ne_bytes(), // struct type
        ]
        .into_iter()
        .flatten()
        .copied()
        .collect();

        let mut parser = Parser::new(&pod);

        let res = parser_get!(&mut parser, Struct {});

        assert!(res.is_ok());
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn parse_complicated_struct() {
        let pod: &[&[u8]] = &[
            &168u32.to_ne_bytes(), // body size: (1 child * 104 bytes) + (4 children * 16 bytes per child) = 168 bytes
            &14u32.to_ne_bytes(),  // struct type
            // begin inner struct
            &96u32.to_ne_bytes(), // body size: (6 children * 16 bytes per child) = 96 bytes
            &14u32.to_ne_bytes(), // struct type
            &4u32.to_ne_bytes(),  // bool body size
            &2u32.to_ne_bytes(),  // bool type
            &1u32.to_ne_bytes(),  // bool "true"
            &[0, 0, 0, 0],        // padding
            &4u32.to_ne_bytes(),  // id body size
            &3u32.to_ne_bytes(),  // id type
            &313u32.to_ne_bytes(), // id 313
            &[0, 0, 0, 0],        // padding
            &4u32.to_ne_bytes(),  // int body size
            &4u32.to_ne_bytes(),  // int type
            &313i32.to_ne_bytes(), // int 313
            &[0, 0, 0, 0],        // padding
            &8u32.to_ne_bytes(),  // long body size
            &5u32.to_ne_bytes(),  // long type
            &313i64.to_ne_bytes(), // long 313
            &4u32.to_ne_bytes(),  // float body size
            &6u32.to_ne_bytes(),  // float type
            &31.3f32.to_ne_bytes(), // float 31.3
            &[0, 0, 0, 0],        // padding
            &8u32.to_ne_bytes(),  // double body size
            &7u32.to_ne_bytes(),  // double type
            &31.3f64.to_ne_bytes(), // double 31.3
            // end inner struct
            &3u32.to_ne_bytes(),   // bytes body size
            &9u32.to_ne_bytes(),   // bytes type
            &[3, 1, 3],            // bytes [3u8, 1u8, 3u8]
            &[0, 0, 0, 0, 0],      // padding
            &8u32.to_ne_bytes(),   // fd body size
            &18u32.to_ne_bytes(),  // fd type
            &313i64.to_ne_bytes(), // fd 313
            &8u32.to_ne_bytes(),   // rectangle body size
            &10u32.to_ne_bytes(),  // rectangle type
            &313u32.to_ne_bytes(), // rectangle width 313
            &131u32.to_ne_bytes(), // rectangle height 131
            &8u32.to_ne_bytes(),   // fraction body size
            &11u32.to_ne_bytes(),  // fraction type
            &313u32.to_ne_bytes(), // fraction num 313
            &131u32.to_ne_bytes(), // fraction denom 131
        ];
        let pod: Vec<u8> = pod.iter().flat_map(|f| (*f)).copied().collect();

        let mut parser = Parser::new(&pod);

        let mut bool = false;
        let mut id = crate::utils::Id(0);
        let mut int = 0i32;
        let mut long = 0i64;
        let mut float = 0.0f32;
        let mut double = 0.0f64;
        let mut bytes: &[u8] = &[];
        let mut fd = 0i64;
        let mut rect = crate::utils::Rectangle {
            width: 0,
            height: 0,
        };
        let mut frac = crate::utils::Fraction { num: 0, denom: 1 };

        let res = parser_get!(
            &mut parser,
            Struct {
                Struct {
                    Bool(&mut bool),
                    Id(&mut id),
                    Int(&mut int),
                    Long(&mut long),
                    Float(&mut float),
                    Double(&mut double),
                },
                Bytes(&mut bytes),
                Fd(&mut fd),
                Rectangle(&mut rect),
                Fraction(&mut frac),
            }
        );

        assert!(res.is_ok());
        assert!(bool);
        assert_eq!(id, crate::utils::Id(313));
        assert_eq!(int, 313);
        assert_eq!(long, 313);
        assert_eq!(float, 31.3);
        assert_eq!(double, 31.3);
        assert_eq!(bytes, &[3, 1, 3]);
        assert_eq!(fd, 313);
        assert_eq!(
            rect,
            crate::utils::Rectangle {
                width: 313,
                height: 131
            }
        );
        assert_eq!(
            frac,
            crate::utils::Fraction {
                num: 313,
                denom: 131
            }
        );
    }
}
