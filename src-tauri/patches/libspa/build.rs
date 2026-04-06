fn main() {
    // Upstream libspa also compiles tests/pod.c here for integration tests only.
    // This fork drops those tests; keep pkg-config probe for libspa headers/libs.
    system_deps::Config::new()
        .probe()
        .expect("Cannot find libspa");
}
