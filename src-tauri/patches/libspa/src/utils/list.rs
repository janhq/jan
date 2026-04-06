// Copyright The pipewire-rs Contributors.
// SPDX-License-Identifier: MIT

//! SPA list

/// Remove an element from its list
pub fn remove(elem: &spa_sys::spa_list) {
    unsafe {
        (*elem.prev).next = elem.next;
        (*elem.next).prev = elem.prev;
    }
}
