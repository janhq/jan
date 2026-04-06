use bitflags::bitflags;

bitflags! {
    /// Flags used to specify different IO events.
    #[derive(Debug, PartialEq, Eq, Clone, Copy)]
    pub struct IoFlags: u32 {
        /// There is data to read
        const IN = spa_sys::SPA_IO_IN;
        /// Writing is possible
        const OUT = spa_sys::SPA_IO_OUT;
        /// An error has occurred
        const ERR = spa_sys::SPA_IO_ERR;
        /// IO channel has hung up
        const HUP = spa_sys::SPA_IO_HUP;
    }
}
