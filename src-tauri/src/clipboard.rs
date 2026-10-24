//! Temporary paste with owned-format backup, plus optional persistent result copy.
use tauri::Manager;
use windows::Win32::{
    Foundation::{GetLastError, GlobalFree, SetLastError, ERROR_SUCCESS, HANDLE, HGLOBAL, HWND},
    Graphics::Gdi::{HBITMAP, HENHMETAFILE},
    System::{
        Com::{STGMEDIUM, STGMEDIUM_0, TYMED_ENHMF, TYMED_GDI, TYMED_HGLOBAL, TYMED_MFPICT},
        DataExchange::*,
        Memory::*,
        Ole::{OleDuplicateData, ReleaseStgMedium, CLIPBOARD_FORMAT},
    },
    UI::Input::KeyboardAndMouse::*,
};

/// Only a failed snapshot, before any clipboard mutation or input, permits typing.
#[derive(Debug, PartialEq, Eq)]
pub enum PasteError {
    PreservationFailed,
    PasteFailed(String),
}
impl From<String> for PasteError {
    fn from(message: String) -> Self {
        Self::PasteFailed(message)
    }
}
impl From<&str> for PasteError {
    fn from(message: &str) -> Self {
        Self::PasteFailed(message.into())
    }
}
pub fn with_unicode_fallback(
    paste: impl FnOnce() -> Result<(), PasteError>,
    type_unicode: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    match paste() {
        Ok(()) => Ok(()),
        Err(PasteError::PreservationFailed) => type_unicode(),
        Err(PasteError::PasteFailed(message)) => Err(message),
    }
}

/// The write callback is unreachable until every format has an owned copy.
fn snapshot_before_write<T>(
    mut next_format: impl FnMut(u32) -> Result<Option<u32>, String>,
    mut duplicate: impl FnMut(u32) -> Result<T, String>,
    begin_write: impl FnOnce() -> Result<(), String>,
) -> Result<Vec<T>, PasteError> {
    let mut items = Vec::new();
    let mut previous = 0;
    while let Some(format) = next_format(previous).map_err(|_| PasteError::PreservationFailed)? {
        items.push(duplicate(format).map_err(|_| PasteError::PreservationFailed)?);
        previous = format;
    }
    // From this boundary onward, fail conservatively instead of risking duplicate
    // output or assuming a failed Windows call left the clipboard untouched.
    begin_write().map_err(PasteError::PasteFailed)?;
    Ok(items)
}

fn checked_setup<T>(
    setup: Result<(), String>,
    writing: T,
    restore_and_close: impl FnOnce(T) -> Result<(), String>,
) -> Result<T, String> {
    match setup {
        Ok(()) => Ok(writing),
        Err(error) => {
            restore_and_close(writing)?;
            Err(error)
        }
    }
}

fn finish_paste(sent: u32, restored: Result<(), String>) -> Result<(), String> {
    let partial = "Some text may already be inserted; check the target before copying the result.";
    if let Err(error) = restored {
        return Err(if sent == 0 {
            error
        } else {
            format!("{error} {partial}")
        });
    }
    match sent {
        4 => Ok(()),
        0 => Err("Windows blocked paste. The target may be running as administrator. Your text is available to copy.".into()),
        _ => Err(format!("Windows stopped paste. {partial}")),
    }
}

type Epoch = (u32, usize);

/// The same publication/read/close ordering is exercised by the fake backend.
trait TransactionClipboard {
    type Open;
    fn open(&mut self) -> Result<Self::Open, String>;
    fn close(&mut self, opened: Self::Open) -> Result<(), String>;
    fn identity(&mut self) -> Epoch;
    fn payload_matches(&mut self) -> Result<bool, String>;
}

/// Keep the clipboard locked until the caller restores or explicitly closes it.
fn owned_open<C: TransactionClipboard>(
    clipboard: &mut C,
    owner: usize,
) -> Result<Option<(C::Open, Epoch)>, String> {
    let opened = clipboard.open()?;
    let verified = (|| {
        for _ in 0..3 {
            let before = clipboard.identity();
            if before.0 == 0 {
                return Err("Clipboard ownership could not be verified.".into());
            }
            if owner == 0 || before.1 != owner || !clipboard.payload_matches()? {
                return Ok(None);
            }
            let after = clipboard.identity();
            if after == before {
                return Ok(Some(after));
            }
            // Reading a synthesized format can advance the sequence. Never
            // adopt that epoch until owner, nonce and text are verified again.
        }
        Err("Clipboard kept changing. Your text is available to copy.".into())
    })();
    match verified {
        Ok(Some(epoch)) => Ok(Some((opened, epoch))),
        Ok(None) => {
            clipboard.close(opened)?;
            Ok(None)
        }
        Err(error) => {
            let _ = clipboard.close(opened);
            Err(error)
        }
    }
}

/// Publishing may add formats at CloseClipboard. Acquire a new, proven epoch
/// after that boundary, then require it to stay stable across the read close.
fn close_and_publish<C: TransactionClipboard>(
    clipboard: &mut C,
    writing: C::Open,
    owner: usize,
) -> Result<Option<Epoch>, String> {
    clipboard.close(writing)?;
    published_lease(clipboard, owner)
}

fn published_lease<C: TransactionClipboard>(
    clipboard: &mut C,
    owner: usize,
) -> Result<Option<Epoch>, String> {
    for _ in 0..3 {
        let Some((opened, epoch)) = owned_open(clipboard, owner)? else {
            return Ok(None);
        };
        clipboard.close(opened)?;
        let after = clipboard.identity();
        if after == epoch {
            return Ok(Some(epoch));
        }
        if after.0 == 0 {
            return Err("Clipboard ownership could not be verified.".into());
        }
        // No input has been sent. Reverify a close-time change under a fresh
        // read lock instead of blindly accepting another writer's sequence.
    }
    Err("Clipboard kept changing. Your text is available to copy.".into())
}

fn dispatch_verified<C: TransactionClipboard, T>(
    clipboard: &mut C,
    owner: usize,
    mut expected: Epoch,
    active: &dyn Fn() -> bool,
    mut validate_target: impl FnMut(&mut C) -> Result<(), String>,
    dispatch: impl FnOnce() -> T,
) -> Result<T, String> {
    for attempt in 0..3 {
        crate::controller::run_if_active(active, || ())?;
        validate_target(clipboard)?;
        crate::controller::run_if_active(active, || ())?;
        let current = clipboard.identity();
        if current == expected {
            // Consumed exactly once, only in this return branch. A partial or
            // failed SendInput can never be replayed by this pre-input loop.
            return dispatch_if_owned(expected, current, active, dispatch);
        }
        if current.0 == 0 || current.1 != owner {
            return Err("Clipboard changed before paste. Your text is available to copy.".into());
        }
        if attempt == 2 {
            break;
        }
        // UIA can take time or trigger delayed format requests. Re-prove the
        // payload, then repeat fresh focus/password/cancellation validation.
        expected = published_lease(clipboard, owner)?
            .ok_or("Clipboard changed before paste. Your text is available to copy.")?;
    }
    Err("Clipboard kept changing. Your text is available to copy.".into())
}

fn dispatch_if_owned<T>(
    expected: (u32, usize),
    current: (u32, usize),
    active: &dyn Fn() -> bool,
    dispatch: impl FnOnce() -> T,
) -> Result<T, String> {
    if expected.0 == 0 || expected.1 == 0 || current != expected {
        return Err("Clipboard changed before paste. Your text is available to copy.".into());
    }
    crate::controller::run_if_active(active, dispatch)
}

fn identity() -> (u32, usize) {
    unsafe {
        (
            GetClipboardSequenceNumber(),
            GetClipboardOwner()
                .map(|owner| owner.0 as usize)
                .unwrap_or(0),
        )
    }
}

fn copyable_format(format: u32) -> Result<u16, String> {
    if format == 0x80 || (0x200..=0x2ff).contains(&format) {
        return Err("Clipboard format requires its original owner.".into());
    }
    u16::try_from(format).map_err(|_| "Clipboard format could not be preserved.".into())
}
struct Open(bool);
impl Open {
    fn close(mut self) -> Result<(), String> {
        unsafe { CloseClipboard().map_err(|_| "Could not close the clipboard.".to_string())? };
        self.0 = false;
        Ok(())
    }
}
impl Drop for Open {
    fn drop(&mut self) {
        if self.0 {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }
}
fn open(owner: HWND) -> Result<Open, String> {
    for _ in 0..20 {
        if unsafe { OpenClipboard(Some(owner)) }.is_ok() {
            return Ok(Open(true));
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    Err(
        "Clipboard is busy. Your transcript is saved; retry or use Unicode typing in Settings."
            .into(),
    )
}
struct Item {
    format: u32,
    handle: Option<HANDLE>,
}
impl Drop for Item {
    fn drop(&mut self) {
        if let Some(handle) = self.handle.take() {
            unsafe {
                let mut medium = STGMEDIUM::default();
                match self.format {
                    2 | 9 => {
                        medium.tymed = TYMED_GDI.0 as u32;
                        medium.u = STGMEDIUM_0 {
                            hBitmap: HBITMAP(handle.0),
                        }
                    }
                    3 => {
                        medium.tymed = TYMED_MFPICT.0 as u32;
                        medium.u = STGMEDIUM_0 {
                            hMetaFilePict: handle.0,
                        }
                    }
                    14 => {
                        medium.tymed = TYMED_ENHMF.0 as u32;
                        medium.u = STGMEDIUM_0 {
                            hEnhMetaFile: HENHMETAFILE(handle.0),
                        }
                    }
                    _ => {
                        medium.tymed = TYMED_HGLOBAL.0 as u32;
                        medium.u = STGMEDIUM_0 {
                            hGlobal: HGLOBAL(handle.0),
                        }
                    }
                }
                ReleaseStgMedium(&mut medium);
            }
        }
    }
}

struct TemporaryClipboard {
    owner: HWND,
    marker_format: u32,
    nonce: [u8; 16],
    text: Vec<u8>,
}

fn matches_prefix(actual: &[u8], expected: &[u8]) -> bool {
    actual.get(..expected.len()) == Some(expected)
}

unsafe fn format_matches(format: u32, expected: &[u8]) -> Result<bool, String> {
    let Ok(handle) = GetClipboardData(format) else {
        return Ok(false);
    };
    let memory = HGLOBAL(handle.0);
    // GlobalAlloc can reserve more than requested. Read only the known bounded
    // payload, including the Unicode terminator, and permit allocator padding.
    if GlobalSize(memory) < expected.len() {
        return Ok(false);
    }
    let pointer = GlobalLock(memory);
    if pointer.is_null() {
        return Err("Temporary clipboard contents could not be verified.".into());
    }
    let matches = matches_prefix(
        std::slice::from_raw_parts(pointer.cast::<u8>(), expected.len()),
        expected,
    );
    let _ = GlobalUnlock(memory);
    Ok(matches)
}

impl TransactionClipboard for TemporaryClipboard {
    type Open = Open;

    fn open(&mut self) -> Result<Open, String> {
        open(self.owner)
    }

    fn close(&mut self, opened: Open) -> Result<(), String> {
        opened.close()
    }

    fn identity(&mut self) -> Epoch {
        identity()
    }

    fn payload_matches(&mut self) -> Result<bool, String> {
        unsafe {
            Ok(format_matches(self.marker_format, &self.nonce)? && format_matches(13, &self.text)?)
        }
    }
}

struct Backup {
    items: Vec<Item>,
    clipboard: TemporaryClipboard,
    armed: bool,
}
impl Backup {
    fn restore(&mut self) -> Result<(), String> {
        if !self.armed {
            return Ok(());
        }
        let owner = self.clipboard.owner.0 as usize;
        let Some((opened, _epoch)) = owned_open(&mut self.clipboard, owner)? else {
            self.armed = false;
            return Ok(());
        };
        let restored = self.restore_locked();
        let closed = self.clipboard.close(opened);
        restored.and(closed)
    }

    /// Only called while holding the write lock or a verified transaction lock.
    fn restore_locked(&mut self) -> Result<(), String> {
        self.armed = false;
        unsafe {
            EmptyClipboard().map_err(|_| "Could not restore clipboard contents.")?;
        }
        for item in &mut self.items {
            if let Some(handle) = item.handle {
                if unsafe { SetClipboardData(item.format, Some(handle)) }.is_ok() {
                    item.handle = None
                } else {
                    return Err(
                        "Could not restore one clipboard format. Check clipboard contents.".into(),
                    );
                }
            }
        }
        Ok(())
    }
}
impl Drop for Backup {
    fn drop(&mut self) {
        let _ = self.restore();
    }
}
unsafe fn allocate_format(format: u32, data: &[u8]) -> Result<Item, String> {
    let memory =
        GlobalAlloc(GMEM_MOVEABLE, data.len()).map_err(|_| "Clipboard allocation failed.")?;
    let pointer = GlobalLock(memory);
    if pointer.is_null() {
        let _ = GlobalFree(Some(memory));
        return Err("Clipboard allocation could not be locked.".into());
    }
    std::ptr::copy_nonoverlapping(data.as_ptr(), pointer.cast::<u8>(), data.len());
    let _ = GlobalUnlock(memory);
    Ok(Item {
        format,
        handle: Some(HANDLE(memory.0)),
    })
}

unsafe fn publish_format(mut item: Item) -> Result<(), String> {
    if SetClipboardData(item.format, item.handle).is_err() {
        return Err("Could not set clipboard contents.".into());
    }
    // Windows owns a successfully published handle. Unpublished handles are
    // released by Item, including those left behind after a partial failure.
    item.handle = None;
    Ok(())
}
unsafe fn put(format: u32, data: &[u8]) -> Result<(), String> {
    publish_format(allocate_format(format, data)?)
}

const PRIVACY_FORMATS: [(&str, u32); 3] = [
    ("CanIncludeInClipboardHistory", 0),
    ("CanUploadToCloudClipboard", 0),
    ("ExcludeClipboardContentFromMonitorProcessing", 1),
];

fn unicode_bytes(text: &str) -> Vec<u8> {
    text.replace("\r\n", "\n")
        .replace('\n', "\r\n")
        .encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(u16::to_le_bytes)
        .collect()
}

fn clipboard_owner(app: &tauri::AppHandle) -> Result<HWND, String> {
    app.get_webview_window("main")
        .and_then(|w| w.hwnd().ok())
        .map(|h| HWND(h.0))
        .ok_or_else(|| "CridVoice's clipboard owner window is unavailable.".into())
}

/// A persistent copy has no focus, input dispatch or temporary-restore step.
/// Preparing every handle precedes opening/emptying the user's clipboard.
trait ResultClipboard {
    type Payload;
    type Open;
    fn prepare(&mut self) -> Result<Vec<Self::Payload>, String>;
    fn open(&mut self) -> Result<Self::Open, String>;
    fn empty(&mut self) -> Result<(), String>;
    fn publish(&mut self, payload: Self::Payload) -> Result<(), String>;
    fn close(&mut self, opened: Self::Open) -> Result<(), String>;
}

fn copy_transaction<C: ResultClipboard>(
    clipboard: &mut C,
    active: &dyn Fn() -> bool,
) -> Result<(), String> {
    crate::controller::run_if_active(active, || ())?;
    let prepared = clipboard.prepare()?;
    crate::controller::run_if_active(active, || ())?;
    let opened = clipboard.open()?;
    let result = (|| {
        // The caller holds the final generation/lifecycle lock. This is the
        // destructive commit boundary; a cancelled/stale take never reaches it.
        crate::controller::run_if_active(active, || ())?;
        clipboard.empty()?;
        for payload in prepared {
            clipboard.publish(payload)?;
        }
        Ok(())
    })();
    let closed = clipboard.close(opened);
    result.and(closed)
}

struct ResultCopy {
    owner: HWND,
    text: Vec<u8>,
}
impl ResultClipboard for ResultCopy {
    type Payload = Item;
    type Open = Open;
    fn prepare(&mut self) -> Result<Vec<Item>, String> {
        let mut prepared = Vec::with_capacity(PRIVACY_FORMATS.len() + 1);
        for (name, value) in PRIVACY_FORMATS {
            let id = unsafe { RegisterClipboardFormatW(&windows::core::HSTRING::from(name)) };
            if id == 0 {
                return Err("Windows could not prepare clipboard privacy controls. Your text is available to copy.".into());
            }
            prepared.push(unsafe { allocate_format(id, &value.to_le_bytes())? });
        }
        // Publish text last, only after every privacy flag has been accepted.
        prepared.push(unsafe { allocate_format(13, &self.text)? });
        Ok(prepared)
    }
    fn open(&mut self) -> Result<Open, String> {
        open(self.owner)
    }
    fn empty(&mut self) -> Result<(), String> {
        unsafe {
            EmptyClipboard().map_err(|_| {
                "Windows could not prepare the clipboard. Your text is available to copy.".into()
            })
        }
    }
    fn publish(&mut self, payload: Item) -> Result<(), String> {
        unsafe { publish_format(payload) }.map_err(|_| "Windows could not copy your dictation. Your text is available to copy in CridVoice.".into())
    }
    fn close(&mut self, opened: Open) -> Result<(), String> {
        opened.close()
    }
}

/// Intentionally replace the clipboard with a completed result. The caller must
/// opt in and hold the lifecycle/generation lock after temporary paste restores.
pub fn copy_result(
    text: &str,
    app: &tauri::AppHandle,
    active: &dyn Fn() -> bool,
) -> Result<(), String> {
    crate::controller::run_if_active(active, || ())?;
    if text.is_empty() || text.contains('\0') {
        return Err(
            "Dictation could not be copied as clipboard text. Copy the result from CridVoice."
                .into(),
        );
    }
    let mut clipboard = ResultCopy {
        owner: clipboard_owner(app)?,
        text: unicode_bytes(text),
    };
    copy_transaction(&mut clipboard, active)
}

pub fn paste(
    text: &str,
    target: &crate::core::Context,
    app: &tauri::AppHandle,
    active: &dyn Fn() -> bool,
) -> Result<(), PasteError> {
    if !active() {
        return Err("Dictation was cancelled.".into());
    }
    let owner = clipboard_owner(app)?;
    let data = unicode_bytes(text);
    let marker_format = unsafe {
        RegisterClipboardFormatW(&windows::core::HSTRING::from("CridVoice.TemporaryPaste"))
    };
    if marker_format == 0 {
        return Err(PasteError::PreservationFailed);
    }
    let clipboard = TemporaryClipboard {
        owner,
        marker_format,
        nonce: *uuid::Uuid::new_v4().as_bytes(),
        text: data,
    };
    let opened = open(owner)?;
    let items = snapshot_before_write(
        |previous| unsafe {
            SetLastError(ERROR_SUCCESS);
            let format = EnumClipboardFormats(previous);
            if format != 0 {
                Ok(Some(format))
            } else if GetLastError() == ERROR_SUCCESS {
                if GetClipboardSequenceNumber() == 0 {
                    Err("Clipboard ownership could not be verified.".into())
                } else {
                    Ok(None)
                }
            } else {
                Err("Clipboard formats could not be enumerated.".into())
            }
        },
        |format| unsafe {
            // Owner-display and private formats can contain application-owned
            // resources whose lifetime cannot be preserved by copying a handle.
            let clip_format = copyable_format(format)?;
            let original = GetClipboardData(format)
                .map_err(|_| "Clipboard format could not be read.".to_string())?;
            let copied = OleDuplicateData(original, CLIPBOARD_FORMAT(clip_format), GMEM_MOVEABLE);
            if copied.is_invalid() {
                return Err("Clipboard format could not be copied.".into());
            }
            Ok(Item {
                format,
                handle: Some(copied),
            })
        },
        || {
            if !active() {
                return Err("Dictation was cancelled.".into());
            }
            unsafe { EmptyClipboard().map_err(|_| "Could not prepare clipboard paste.".into()) }
        },
    )?;
    let mut backup = Backup {
        items,
        clipboard,
        armed: true,
    };
    let setup = (|| unsafe {
        put(marker_format, &backup.clipboard.nonce)?;
        put(13, &backup.clipboard.text)?;
        for (name, value) in PRIVACY_FORMATS {
            let id = RegisterClipboardFormatW(&windows::core::HSTRING::from(name));
            if id != 0 {
                put(id, &value.to_le_bytes())?
            }
        }
        Ok::<(), String>(())
    })();
    let opened = checked_setup(setup, opened, |opened| {
        // A failed marker/text write cannot authenticate a published payload.
        // The still-held write lock is the proof that restoration is safe here.
        let restored = backup.restore_locked();
        let closed = opened.close();
        restored.and(closed)
    })?;
    let expected = close_and_publish(&mut backup.clipboard, opened, owner.0 as usize)?
        .ok_or("Clipboard changed before paste. Your text is available to copy.")?;
    let keys = [
        (VK_CONTROL, KEYBD_EVENT_FLAGS(0)),
        (VIRTUAL_KEY(0x56), KEYBD_EVENT_FLAGS(0)),
        (VIRTUAL_KEY(0x56), KEYEVENTF_KEYUP),
        (VK_CONTROL, KEYEVENTF_KEYUP),
    ];
    let inputs = keys.map(|(vk, flags)| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    });
    // Setting temporary clipboard formats can take time. Check cancellation at
    // the actual input boundary so a cancelled take never sends Ctrl+V.
    let sent = dispatch_verified(
        &mut backup.clipboard,
        owner.0 as usize,
        expected,
        active,
        |_| crate::native::validate_current_insertion_target(target, active),
        || unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) },
    )?;
    std::thread::sleep(std::time::Duration::from_millis(250));
    finish_paste(sent, backup.restore())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::collections::BTreeMap;
    use std::rc::Rc;

    struct CopyPayload {
        format: u32,
        owned: bool,
        released: Rc<Cell<usize>>,
    }
    impl Drop for CopyPayload {
        fn drop(&mut self) {
            if self.owned {
                self.released.set(self.released.get() + 1);
            }
        }
    }
    struct FakeResultCopy {
        active: Rc<Cell<bool>>,
        events: RefCell<Vec<&'static str>>,
        released: Rc<Cell<usize>>,
        cancel_after: Option<&'static str>,
        fail: Option<&'static str>,
        published: Vec<u32>,
    }
    impl Default for FakeResultCopy {
        fn default() -> Self {
            Self {
                active: Rc::new(Cell::new(true)),
                events: RefCell::new(vec![]),
                released: Rc::new(Cell::new(0)),
                cancel_after: None,
                fail: None,
                published: vec![],
            }
        }
    }
    impl FakeResultCopy {
        fn phase(&self, phase: &'static str) -> Result<(), String> {
            self.events.borrow_mut().push(phase);
            if self.cancel_after == Some(phase) {
                self.active.set(false);
            }
            if self.fail == Some(phase) {
                Err(format!("Fixture {phase} failed"))
            } else {
                Ok(())
            }
        }
        fn run(&mut self) -> Result<(), String> {
            let active = self.active.clone();
            copy_transaction(self, &|| active.get())
        }
    }
    impl ResultClipboard for FakeResultCopy {
        type Payload = CopyPayload;
        type Open = ();
        fn prepare(&mut self) -> Result<Vec<CopyPayload>, String> {
            self.events.borrow_mut().push("prepare");
            let mut prepared = Vec::new();
            // Three privacy formats precede the Unicode payload.
            for format in [1, 2, 3, 13] {
                if self.fail == Some("allocate") && prepared.len() == 2 {
                    return Err("Fixture allocation failed".into());
                }
                prepared.push(CopyPayload {
                    format,
                    owned: true,
                    released: self.released.clone(),
                });
            }
            if self.cancel_after == Some("prepare") {
                self.active.set(false);
            }
            Ok(prepared)
        }
        fn open(&mut self) -> Result<(), String> {
            self.phase("open")
        }
        fn empty(&mut self) -> Result<(), String> {
            self.phase("empty")
        }
        fn publish(&mut self, mut payload: CopyPayload) -> Result<(), String> {
            self.phase(if payload.format == 13 {
                "text"
            } else {
                "privacy"
            })?;
            payload.owned = false;
            self.published.push(payload.format);
            Ok(())
        }
        fn close(&mut self, _: ()) -> Result<(), String> {
            self.phase("close")
        }
    }

    #[test]
    fn persistent_copy_cancellation_before_commit_keeps_the_clipboard_untouched() {
        let mut before = FakeResultCopy::default();
        before.active.set(false);
        assert!(before.run().is_err());
        assert!(before.events.borrow().is_empty());
        for phase in ["prepare", "open"] {
            let mut clipboard = FakeResultCopy {
                cancel_after: Some(phase),
                ..Default::default()
            };
            assert!(clipboard.run().unwrap_err().contains("cancelled"));
            assert!(!clipboard.events.borrow().contains(&"empty"));
            assert!(clipboard.published.is_empty());
            assert_eq!(clipboard.released.get(), 4);
            assert_eq!(
                clipboard.events.borrow().contains(&"close"),
                phase == "open"
            );
        }
    }

    #[test]
    fn persistent_copy_allocates_every_payload_before_empty_and_releases_failed_preparation() {
        let mut clipboard = FakeResultCopy {
            fail: Some("allocate"),
            ..Default::default()
        };
        assert!(clipboard.run().is_err());
        assert_eq!(*clipboard.events.borrow(), vec!["prepare"]);
        assert_eq!(clipboard.released.get(), 2);
        assert!(clipboard.published.is_empty());
    }

    #[test]
    fn persistent_copy_failure_does_not_publish_text_without_privacy_or_retry() {
        let mut clipboard = FakeResultCopy {
            fail: Some("privacy"),
            ..Default::default()
        };
        assert!(clipboard.run().is_err());
        assert_eq!(
            *clipboard.events.borrow(),
            vec!["prepare", "open", "empty", "privacy", "close"]
        );
        assert_eq!(clipboard.released.get(), 4);
        assert!(clipboard.published.is_empty());
    }

    #[test]
    fn persistent_copy_completion_leaves_unicode_text_after_privacy_without_restoration() {
        let mut clipboard = FakeResultCopy::default();
        clipboard.run().unwrap();
        assert_eq!(clipboard.published, vec![1, 2, 3, 13]);
        assert_eq!(clipboard.released.get(), 0);
        assert_eq!(
            *clipboard.events.borrow(),
            vec!["prepare", "open", "empty", "privacy", "privacy", "privacy", "text", "close"]
        );
    }

    #[test]
    fn persistent_copy_open_empty_and_publication_failures_release_unpublished_handles() {
        for (failure, released, closed) in [
            ("open", 4, false),
            ("empty", 4, true),
            ("text", 1, true),
            ("close", 0, true),
        ] {
            let mut clipboard = FakeResultCopy {
                fail: Some(failure),
                ..Default::default()
            };
            assert!(clipboard.run().is_err());
            assert_eq!(clipboard.released.get(), released);
            assert_eq!(clipboard.events.borrow().contains(&"close"), closed);
            assert_eq!(clipboard.published.contains(&13), failure == "close");
        }
    }

    #[test]
    fn persistent_copy_unicode_encoding_preserves_newlines_and_non_ascii_text() {
        let bytes = unicode_bytes("Łódź 🐈\nline\r\nlast");
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .collect();
        assert_eq!(
            String::from_utf16(&units).unwrap(),
            "Łódź 🐈\r\nline\r\nlast\0"
        );
        assert_eq!(
            PRIVACY_FORMATS,
            [
                ("CanIncludeInClipboardHistory", 0),
                ("CanUploadToCloudClipboard", 0),
                ("ExcludeClipboardContentFromMonitorProcessing", 1)
            ]
        );
    }

    enum Change {
        Sequence(u32),
        Owner(usize),
        Text(Vec<u8>),
        Nonce(Vec<u8>),
    }

    struct FakeClipboard {
        epoch: Epoch,
        text: Vec<u8>,
        nonce: Vec<u8>,
        expected_text: Vec<u8>,
        expected_nonce: Vec<u8>,
        opened: bool,
        opens: usize,
        closes: usize,
        close_changes: BTreeMap<usize, Vec<Change>>,
        probe_changes: BTreeMap<usize, Vec<Change>>,
        probes: usize,
        fail_open: bool,
        fail_close: Option<usize>,
    }
    struct FakeOpen;
    impl Default for FakeClipboard {
        fn default() -> Self {
            let text: Vec<u8> = "Łódź 🐈\r\nfixture\0"
                .encode_utf16()
                .flat_map(u16::to_le_bytes)
                .collect();
            Self {
                epoch: (10, 99),
                text: text.clone(),
                expected_text: text,
                nonce: vec![7; 16],
                expected_nonce: vec![7; 16],
                opened: false,
                opens: 0,
                closes: 0,
                close_changes: BTreeMap::new(),
                probe_changes: BTreeMap::new(),
                probes: 0,
                fail_open: false,
                fail_close: None,
            }
        }
    }
    impl FakeClipboard {
        fn change(&mut self, changes: Vec<Change>) {
            for change in changes {
                match change {
                    Change::Sequence(value) => self.epoch.0 = value,
                    Change::Owner(value) => self.epoch.1 = value,
                    Change::Text(value) => self.text = value,
                    Change::Nonce(value) => self.nonce = value,
                }
            }
        }
    }
    impl TransactionClipboard for FakeClipboard {
        type Open = FakeOpen;
        fn open(&mut self) -> Result<FakeOpen, String> {
            if self.fail_open {
                return Err("Busy.".into());
            }
            assert!(!self.opened);
            self.opened = true;
            self.opens += 1;
            Ok(FakeOpen)
        }
        fn close(&mut self, _: FakeOpen) -> Result<(), String> {
            assert!(self.opened);
            self.opened = false;
            self.closes += 1;
            if let Some(changes) = self.close_changes.remove(&self.closes) {
                self.change(changes);
            }
            if self.fail_close == Some(self.closes) {
                Err("Could not close the clipboard.".into())
            } else {
                Ok(())
            }
        }
        fn identity(&mut self) -> Epoch {
            self.epoch
        }
        fn payload_matches(&mut self) -> Result<bool, String> {
            assert!(self.opened);
            self.probes += 1;
            if let Some(changes) = self.probe_changes.remove(&self.probes) {
                self.change(changes);
            }
            Ok(matches_prefix(&self.nonce, &self.expected_nonce)
                && matches_prefix(&self.text, &self.expected_text))
        }
    }

    fn publish(clipboard: &mut FakeClipboard) -> Result<Option<Epoch>, String> {
        let writing = clipboard.open()?;
        close_and_publish(clipboard, writing, 99)
    }

    #[test]
    fn published_epoch_is_captured_after_the_actual_write_close() {
        let mut clipboard = FakeClipboard::default();
        clipboard
            .close_changes
            .insert(1, vec![Change::Sequence(11)]);
        let epoch = publish(&mut clipboard).unwrap().unwrap();
        assert_eq!(epoch, (11, 99));
        assert_eq!(clipboard.closes, 2);
        assert!(!clipboard.opened);
        let sent = Cell::new(0);
        dispatch_if_owned(epoch, clipboard.identity(), &|| true, || {
            sent.set(sent.get() + 1)
        })
        .unwrap();
        assert_eq!(sent.get(), 1);
    }

    #[test]
    fn a_change_during_read_close_requires_fresh_payload_proof_before_input() {
        let mut clipboard = FakeClipboard::default();
        clipboard
            .close_changes
            .insert(1, vec![Change::Sequence(11)]);
        clipboard
            .close_changes
            .insert(2, vec![Change::Sequence(12)]);
        let epoch = publish(&mut clipboard).unwrap().unwrap();
        assert_eq!(epoch, (12, 99));
        assert_eq!(clipboard.probes, 2);
        assert_eq!(clipboard.closes, 3);
        let sent = Cell::new(0);
        dispatch_if_owned(epoch, clipboard.identity(), &|| true, || {
            sent.set(sent.get() + 1)
        })
        .unwrap();
        assert_eq!(sent.get(), 1);
    }

    #[test]
    fn late_validation_materialization_reproves_payload_and_dispatches_at_most_once() {
        for returned in [0, 1, 4] {
            let mut clipboard = FakeClipboard::default();
            let expected = publish(&mut clipboard).unwrap().unwrap();
            let validations = Cell::new(0);
            let sends = Cell::new(0);
            let result = dispatch_verified(
                &mut clipboard,
                99,
                expected,
                &|| true,
                |clipboard| {
                    validations.set(validations.get() + 1);
                    if validations.get() == 1 {
                        clipboard.epoch.0 += 1;
                    }
                    Ok(())
                },
                || {
                    sends.set(sends.get() + 1);
                    returned
                },
            );
            assert_eq!(result.unwrap(), returned);
            assert_eq!(validations.get(), 2);
            assert_eq!(sends.get(), 1);
            assert!(!clipboard.opened);
        }
    }

    #[test]
    fn fresh_focus_password_and_cancellation_failure_abort_a_late_retry() {
        for failure in ["Focus changed.", "Password field.", "cancel"] {
            let mut clipboard = FakeClipboard::default();
            let expected = publish(&mut clipboard).unwrap().unwrap();
            let active = Cell::new(true);
            let validations = Cell::new(0);
            let sends = Cell::new(0);
            let result = dispatch_verified(
                &mut clipboard,
                99,
                expected,
                &|| active.get(),
                |clipboard| {
                    validations.set(validations.get() + 1);
                    if validations.get() == 1 {
                        clipboard.epoch.0 += 1;
                        Ok(())
                    } else if failure == "cancel" {
                        active.set(false);
                        Ok(())
                    } else {
                        Err(failure.into())
                    }
                },
                || sends.set(sends.get() + 1),
            );
            assert!(result.is_err());
            assert_eq!(validations.get(), 2);
            assert_eq!(sends.get(), 0);
            assert!(!clipboard.opened);
        }
    }

    #[test]
    fn late_foreign_or_unknown_clipboard_is_not_rebased_or_overwritten() {
        for change in [
            Change::Owner(100),
            Change::Text(vec![0; 2]),
            Change::Nonce(vec![]),
            Change::Sequence(0),
        ] {
            let mut clipboard = FakeClipboard::default();
            let expected = publish(&mut clipboard).unwrap().unwrap();
            let sends = Cell::new(0);
            let mut change = Some(change);
            let result = dispatch_verified(
                &mut clipboard,
                99,
                expected,
                &|| true,
                |clipboard| {
                    clipboard.epoch.0 += 1;
                    clipboard.change(vec![change.take().unwrap()]);
                    Ok(())
                },
                || sends.set(sends.get() + 1),
            );
            assert!(result.is_err());
            assert_eq!(sends.get(), 0);
            let replacement = (
                clipboard.epoch,
                clipboard.text.clone(),
                clipboard.nonce.clone(),
            );
            assert!(!matches!(owned_open(&mut clipboard, 99), Ok(Some(_))));
            assert_eq!(
                replacement,
                (
                    clipboard.epoch,
                    clipboard.text.clone(),
                    clipboard.nonce.clone()
                )
            );
        }
    }

    #[test]
    fn late_materialization_retries_are_bounded_and_never_type_as_fallback() {
        let mut clipboard = FakeClipboard::default();
        let expected = publish(&mut clipboard).unwrap().unwrap();
        let validations = Cell::new(0);
        let sends = Cell::new(0);
        let typed = Cell::new(false);
        let result = with_unicode_fallback(
            || {
                dispatch_verified(
                    &mut clipboard,
                    99,
                    expected,
                    &|| true,
                    |clipboard| {
                        validations.set(validations.get() + 1);
                        clipboard.epoch.0 += 1;
                        Ok(())
                    },
                    || sends.set(sends.get() + 1),
                )?;
                Ok(())
            },
            || {
                typed.set(true);
                Ok(())
            },
        );
        assert!(result.is_err());
        assert_eq!(validations.get(), 3);
        assert_eq!(sends.get(), 0);
        assert!(!typed.get());
        assert!(!clipboard.opened);
    }

    #[test]
    fn foreign_replacement_at_either_close_is_never_adopted_or_restored_over() {
        for close in [1, 2] {
            for change in [
                Change::Owner(100),
                Change::Text(vec![0; 2]),
                Change::Nonce(vec![]),
            ] {
                let mut clipboard = FakeClipboard::default();
                clipboard
                    .close_changes
                    .insert(close, vec![Change::Sequence(11), change]);
                assert!(publish(&mut clipboard).unwrap().is_none());
                let replacement = (
                    clipboard.epoch,
                    clipboard.text.clone(),
                    clipboard.nonce.clone(),
                );
                assert!(owned_open(&mut clipboard, 99).unwrap().is_none());
                assert_eq!(
                    replacement,
                    (
                        clipboard.epoch,
                        clipboard.text.clone(),
                        clipboard.nonce.clone()
                    )
                );
                assert!(!clipboard.opened);
            }
        }
    }

    #[test]
    fn synthesized_data_during_probe_is_reverified_under_the_same_lock() {
        let mut clipboard = FakeClipboard::default();
        clipboard
            .probe_changes
            .insert(1, vec![Change::Sequence(11)]);
        let (opened, epoch) = owned_open(&mut clipboard, 99).unwrap().unwrap();
        assert_eq!(epoch, (11, 99));
        assert_eq!(clipboard.opens, 1);
        assert_eq!(clipboard.probes, 2);
        clipboard.close(opened).unwrap();
    }

    #[test]
    fn payload_proof_allows_allocator_padding_but_rejects_truncation_and_wrong_nonce() {
        let mut clipboard = FakeClipboard::default();
        clipboard.text.extend([0x55; 8]);
        clipboard.nonce.extend([0xaa; 8]);
        let (opened, _) = owned_open(&mut clipboard, 99).unwrap().unwrap();
        clipboard.close(opened).unwrap();
        for removed_bytes in [1, 2, 3] {
            let mut clipboard = FakeClipboard::default();
            clipboard
                .text
                .truncate(clipboard.text.len() - removed_bytes);
            assert!(owned_open(&mut clipboard, 99).unwrap().is_none());
        }
        let mut clipboard = FakeClipboard::default();
        clipboard.nonce[0] ^= 1;
        assert!(owned_open(&mut clipboard, 99).unwrap().is_none());
    }

    #[test]
    fn unstable_or_failed_close_is_terminal_without_input_or_unicode_retry() {
        for failure in [0, 1, 2] {
            let mut clipboard = FakeClipboard::default();
            if failure == 0 {
                for close in 2..=4 {
                    clipboard
                        .close_changes
                        .insert(close, vec![Change::Sequence(10 + close as u32)]);
                }
            } else {
                clipboard.fail_close = Some(failure);
            }
            let sent = Cell::new(0);
            let typed = Cell::new(0);
            let result = with_unicode_fallback(
                || {
                    let expected = publish(&mut clipboard)?.ok_or("Foreign clipboard.")?;
                    dispatch_if_owned(expected, clipboard.identity(), &|| true, || {
                        sent.set(sent.get() + 1)
                    })?;
                    Ok(())
                },
                || {
                    typed.set(typed.get() + 1);
                    Ok(())
                },
            );
            assert!(result.is_err());
            assert_eq!(sent.get(), 0);
            assert_eq!(typed.get(), 0);
            assert!(!clipboard.opened);
        }
    }

    #[test]
    fn failed_marker_setup_restores_original_before_unlocking_without_retry() {
        let mut clipboard = FakeClipboard::default();
        clipboard.nonce.clear();
        let writing = clipboard.open().unwrap();
        let restored = Cell::new(false);
        let typed = Cell::new(false);
        let result = with_unicode_fallback(
            || {
                checked_setup(Err("Marker allocation failed.".into()), writing, |opened| {
                    assert!(clipboard.opened);
                    assert!(!clipboard.payload_matches().unwrap());
                    restored.set(true);
                    clipboard.close(opened)
                })?;
                Ok(())
            },
            || {
                typed.set(true);
                Ok(())
            },
        );
        assert!(result.is_err());
        assert!(restored.get());
        assert!(!clipboard.opened);
        assert!(!typed.get());
    }

    #[test]
    fn restoration_error_preserves_possible_insertion_warning_without_replay() {
        for sent in [0, 1, 4] {
            let typed = Cell::new(false);
            let result = with_unicode_fallback(
                || {
                    finish_paste(sent, Err("Restoration failed.".into()))?;
                    Ok(())
                },
                || {
                    typed.set(true);
                    Ok(())
                },
            );
            let error = result.unwrap_err();
            assert!(error.contains("Restoration failed"));
            assert_eq!(error.contains("may already be inserted"), sent != 0);
            assert!(!typed.get());
        }
        assert!(finish_paste(4, Ok(())).is_ok());
        assert!(finish_paste(1, Ok(()))
            .unwrap_err()
            .contains("may already be inserted"));
        assert!(finish_paste(0, Ok(())).unwrap_err().contains("blocked"));
    }

    struct OwnedCopy(Rc<Cell<usize>>);
    impl Drop for OwnedCopy {
        fn drop(&mut self) {
            self.0.set(self.0.get() + 1);
        }
    }

    #[test]
    fn failed_snapshot_never_writes_and_releases_all_owned_copies() {
        for enumeration_failure in [false, true] {
            let released = Rc::new(Cell::new(0));
            let writes = Cell::new(0);
            let types = Cell::new(0);
            let result = with_unicode_fallback(
                || {
                    snapshot_before_write(
                        |previous| match previous {
                            0 => Ok(Some(13)),
                            13 if enumeration_failure => Err("Enumeration failed.".into()),
                            13 => Ok(Some(0xc000)),
                            _ => Ok(None),
                        },
                        |format| {
                            if format == 13 {
                                Ok(OwnedCopy(released.clone()))
                            } else {
                                Err("Delayed format could not be copied.".into())
                            }
                        },
                        || {
                            writes.set(writes.get() + 1);
                            Ok(())
                        },
                    )?;
                    Ok(())
                },
                || {
                    types.set(types.get() + 1);
                    Ok(())
                },
            );
            assert!(result.is_ok());
            assert_eq!(writes.get(), 0);
            assert_eq!(types.get(), 1);
            assert_eq!(released.get(), 1);
        }
    }

    #[test]
    fn owner_dependent_formats_are_rejected_before_retrieving_handles() {
        for format in [0x80, 0x200, 0x2ff, 0x1_0000] {
            assert!(copyable_format(format).is_err());
        }
        for format in [2, 9, 13, 14, 0x300, 0xc000, 0xffff] {
            assert_eq!(copyable_format(format).unwrap(), format as u16);
        }
    }

    #[test]
    fn attempted_write_failure_is_terminal_even_without_dispatched_input() {
        let writes = Cell::new(0);
        let types = Cell::new(0);
        let result = with_unicode_fallback(
            || {
                snapshot_before_write(
                    |_| Ok(None),
                    |_| Ok(()),
                    || {
                        writes.set(writes.get() + 1);
                        Err("Could not prepare clipboard paste.".into())
                    },
                )?;
                Ok(())
            },
            || {
                types.set(types.get() + 1);
                Ok(())
            },
        );
        assert!(result.is_err());
        assert_eq!(writes.get(), 1);
        assert_eq!(types.get(), 0);
    }

    #[test]
    fn successful_paste_and_partial_or_restore_errors_never_type_again() {
        for error in [
            None,
            Some("Partial paste."),
            Some("Restoration failed."),
            Some("Clipboard is busy."),
        ] {
            let pastes = Cell::new(0);
            let types = Cell::new(0);
            let result = with_unicode_fallback(
                || {
                    pastes.set(pastes.get() + 1);
                    error.map_or(Ok(()), |message| {
                        Err(PasteError::PasteFailed(message.into()))
                    })
                },
                || {
                    types.set(types.get() + 1);
                    Ok(())
                },
            );
            assert_eq!(result.is_err(), error.is_some());
            assert_eq!(pastes.get(), 1);
            assert_eq!(types.get(), 0);
        }
    }

    #[test]
    fn restoration_accepts_synthesis_only_while_nonce_and_text_are_still_ours() {
        let mut clipboard = FakeClipboard {
            epoch: (12, 99),
            ..Default::default()
        };
        let Some((opened, epoch)) = owned_open(&mut clipboard, 99).unwrap() else {
            panic!("owned synthesis");
        };
        assert_eq!(epoch, (12, 99));
        assert!(clipboard.opened);
        clipboard.close(opened).unwrap();
        for changes in [
            vec![Change::Owner(100)],
            vec![Change::Text(vec![0; 2])],
            vec![Change::Nonce(vec![])],
        ] {
            let mut clipboard = FakeClipboard::default();
            clipboard.change(changes);
            assert!(owned_open(&mut clipboard, 99).unwrap().is_none());
            assert!(!clipboard.opened);
        }
    }

    #[test]
    fn unknown_sequence_never_claims_restoration_and_busy_open_can_be_retried() {
        let mut clipboard = FakeClipboard {
            epoch: (0, 99),
            ..Default::default()
        };
        assert!(owned_open(&mut clipboard, 99).is_err());
        assert!(!clipboard.opened);
        clipboard.epoch = (10, 99);
        clipboard.fail_open = true;
        assert!(owned_open(&mut clipboard, 99).is_err());
        clipboard.fail_open = false;
        let (opened, _) = owned_open(&mut clipboard, 99).unwrap().unwrap();
        clipboard.close(opened).unwrap();
    }

    #[test]
    fn changed_clipboard_or_cancellation_dispatches_nothing_and_cannot_fallback() {
        for (current, active) in [
            ((11, 99), true),
            ((10, 100), true),
            ((0, 99), true),
            ((10, 99), false),
        ] {
            let inputs = Cell::new(0);
            let types = Cell::new(0);
            let result = with_unicode_fallback(
                || {
                    dispatch_if_owned((10, 99), current, &|| active, || {
                        inputs.set(inputs.get() + 1)
                    })?;
                    Ok(())
                },
                || {
                    types.set(types.get() + 1);
                    Ok(())
                },
            );
            assert!(result.is_err());
            assert_eq!(inputs.get(), 0);
            assert_eq!(types.get(), 0);
        }
    }
}
