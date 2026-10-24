#[cfg(windows)]
mod audio;
#[cfg(windows)]
mod clipboard;
pub mod coding;
pub mod config;
pub mod controller;
pub mod core;
#[cfg(windows)]
mod desktop;
#[cfg(any(windows, test))]
mod diagnostics;
#[cfg(windows)]
mod discovery;
#[cfg(windows)]
mod downloads;
#[cfg(windows)]
mod inference;
#[cfg(any(windows, test))]
mod model_operations;
#[cfg(windows)]
mod native;
pub mod setup;
pub mod store;
#[cfg(windows)]
mod vault;
pub mod warmup;
pub fn run() {
    #[cfg(windows)]
    desktop::run();
    #[cfg(not(windows))]
    eprintln!("CridVoice desktop requires Windows 11 x64. Run the frontend preview or core tests on this platform.");
}
