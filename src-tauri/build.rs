fn main() {
    // tauri-build embeds icon.ico into the exe, but does not watch that file
    // unless the codegen context is enabled. Without this, icon edits never relink.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    println!("cargo:rerun-if-changed=icons/128x128.png");
    println!("cargo:rerun-if-changed=icons/128x128@2x.png");
    println!("cargo:rerun-if-changed=icons/icon.icns");
    tauri_build::build()
}
