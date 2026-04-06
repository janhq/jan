fn main() {
    // FIXME: It would be nice to run this only when tests are run.
    println!("cargo:rerun-if-changed=tests/pod.c");

    let libs = system_deps::Config::new()
        .probe()
        .expect("Cannot find libspa");
    let libspa = libs.get_by_name("libspa").unwrap();

    cc::Build::new()
        .file("tests/pod.c")
        .shared_flag(true)
        .flag("-Wno-missing-field-initializers")
        .includes(&libspa.include_paths)
        .compile("pod");
}
