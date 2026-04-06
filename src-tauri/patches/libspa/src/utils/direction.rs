// Copyright The pipewire-rs Contributors.
// SPDX-License-Identifier: MIT

//! SPA direction.

#[derive(Copy, Clone, PartialEq, Eq)]
pub struct Direction(spa_sys::spa_direction);

#[allow(non_upper_case_globals)]
impl Direction {
    pub const Input: Self = Self(spa_sys::SPA_DIRECTION_INPUT);
    pub const Output: Self = Self(spa_sys::SPA_DIRECTION_OUTPUT);

    pub fn from_raw(raw: spa_sys::spa_direction) -> Self {
        Self(raw)
    }

    pub fn as_raw(&self) -> spa_sys::spa_direction {
        self.0
    }

    /// Return a new [`Direction`] in the opposite direction, turning Input to Output, and Output to Input.
    ///
    /// An unknown/invalid direction is unchanged.
    pub fn reverse(&self) -> Self {
        match *self {
            Self::Input => Self::Output,
            Self::Output => Self::Input,
            _ => *self,
        }
    }
}

impl std::fmt::Debug for Direction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let name = format!(
            "Direction::{}",
            match *self {
                Self::Input => "Input",
                Self::Output => "Output",
                _ => "Unknown",
            }
        );
        f.write_str(&name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn as_raw() {
        assert_eq!(Direction::Input.as_raw(), spa_sys::SPA_DIRECTION_INPUT);
        assert_eq!(Direction::Output.as_raw(), spa_sys::SPA_DIRECTION_OUTPUT);
    }

    #[test]
    fn from_raw() {
        assert_eq!(
            Direction::Input,
            Direction::from_raw(spa_sys::SPA_DIRECTION_INPUT)
        );
        assert_eq!(
            Direction::Output,
            Direction::from_raw(spa_sys::SPA_DIRECTION_OUTPUT)
        );
    }

    #[test]
    fn reverse() {
        assert_eq!(Direction::Output.reverse(), Direction::Input);
        assert_eq!(Direction::Input.reverse(), Direction::Output);
    }
}
