// Copyright The pipewire-rs Contributors.
// SPDX-License-Identifier: MIT

//! SPA hook

use crate::utils::list;

/// Remove a hook
pub fn remove(mut hook: spa_sys::spa_hook) {
    list::remove(&hook.link);

    if let Some(removed) = hook.removed {
        unsafe {
            removed(&mut hook as *mut _);
        }
    }
}

/// Call a method on a spa_interface.
///
/// This needs to be called from within an `unsafe` block.
///
/// The macro always takes at least three arguments:
/// 1. A pointer to a C struct that can be casted to a spa_interface.
/// 2. The type of the interfaces methods struct.
/// 3. The name of the method that should be called.
///
/// All additional arguments are added as arguments to the call in the order they are provided.
///
/// The macro returns whatever the called method returns, for example an `i32`, or `()` if the method returns nothing.
///
/// # Examples
/// Here we call the sync method on a `pipewire_sys::pw_core` object.
/// ```
/// use pipewire_sys as pw_sys;
/// use libspa as spa;
///
/// struct Core {
///     ptr: *mut pw_sys::pw_core
/// }
///
/// impl Core {
///     fn sync(&self, seq: i32) -> i32 {
///         unsafe {
///             spa::spa_interface_call_method!(
///                 &self.ptr, pw_sys::pw_core_methods, sync, pipewire::core::PW_ID_CORE, seq
///             )
///         }
///     }
/// }
/// ```
#[macro_export]
macro_rules! spa_interface_call_method {
    ($interface_ptr:expr, $methods_struct:ty, $method:ident, $( $arg:expr ),*) => {{
        let iface: *mut spa_sys::spa_interface = $interface_ptr.cast();
        let funcs: *const $methods_struct = (*iface).cb.funcs.cast();
        let f = (*funcs).$method.unwrap();

        f((*iface).cb.data, $($arg),*)
    }};
}
