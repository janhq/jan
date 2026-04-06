fn main() {
    system_deps::Config::new()
        .probe()
        .expect("Cannot find libspa");
}
