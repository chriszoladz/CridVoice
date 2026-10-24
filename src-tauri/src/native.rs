use crate::{
    core::{parse_shortcut, Context, FocusAnchor, Shortcut},
    desktop,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{self, SyncSender},
    Arc, Mutex, OnceLock,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
#[path = "shortcut_capture.rs"]
mod shortcut_capture;
pub(crate) use shortcut_capture::Event as ShortcutCaptureEvent;
use windows::{
    core::Interface,
    Win32::{
        Foundation::{CloseHandle, HANDLE, HWND, LPARAM, LRESULT, WPARAM},
        System::{Com::*, JobObjects::*, Ole::*, Threading::*},
        UI::{Accessibility::*, Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
    },
};
static APP: OnceLock<AppHandle> = OnceLock::new();
static JOB: Mutex<Option<usize>> = Mutex::new(None);
pub fn attach_to_job(child: &tokio::process::Child) -> Result<(), String> {
    unsafe {
        let mut job = JOB.lock().unwrap();
        if job.is_none() {
            let handle = CreateJobObjectW(None, None)
                .map_err(|_| "Could not create the inference process group.")?;
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            )
            .is_err()
            {
                let _ = CloseHandle(handle);
                return Err("Could not configure the inference process group.".into());
            }
            *job = Some(handle.0 as usize);
        }
        let raw = child
            .raw_handle()
            .ok_or("Inference process handle is unavailable.")?;
        AssignProcessToJobObject(HANDLE(job.unwrap() as *mut _), HANDLE(raw))
            .map_err(|_| "Could not attach the inference process to CridVoice.".into())
    }
}
static KEYS: Mutex<KeyState> = Mutex::new(KeyState::new());
struct KeyState {
    down: [bool; 256],
    hold: bool,
    toggle: bool,
    rewrite: bool,
    win_suppressed: [bool; 2],
    win_forwarded: [bool; 2],
    win_rearm: [bool; 2],
    capture: shortcut_capture::Capture,
    capture_window: isize,
}
#[derive(Debug, Default, PartialEq, Eq)]
struct KeyDecision {
    action: Option<(&'static str, bool)>,
    swallow: bool,
    cancel_start_menu: bool,
}
#[derive(Clone, Copy)]
struct KeyEvent {
    key: u16,
    scan: u32,
    extended: bool,
    pressed: bool,
    injected: bool,
}
const MODIFIER_KEYS: [u16; 8] = [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0x5b, 0x5c];
fn sided_key(event: KeyEvent) -> u16 {
    match event.key {
        0x10 => {
            if event.scan == 0x36 {
                0xa1
            } else {
                0xa0
            }
        }
        0x11 => {
            if event.extended {
                0xa3
            } else {
                0xa2
            }
        }
        0x12 => {
            if event.extended {
                0xa5
            } else {
                0xa4
            }
        }
        key => key,
    }
}
fn shortcut_key(s: &Shortcut, key: u16) -> bool {
    match key {
        0xa2 | 0xa3 => s.ctrl,
        0xa4 | 0xa5 => s.alt,
        0xa0 | 0xa1 => s.shift,
        0x5b | 0x5c => s.super_key,
        _ => s.key == Some(key),
    }
}
impl KeyState {
    const fn new() -> Self {
        Self {
            down: [false; 256],
            hold: false,
            toggle: false,
            rewrite: false,
            win_suppressed: [false; 2],
            win_forwarded: [false; 2],
            win_rearm: [true; 2],
            capture: shortcut_capture::Capture::new(),
            capture_window: 0,
        }
    }

    fn begin_capture(
        &mut self,
        id: String,
        owner: isize,
        mut held: [bool; 256],
    ) -> Result<ShortcutCaptureEvent, String> {
        // A forwarded Windows down must retain its OS-facing up even if an
        // async query cannot confirm it. A stale cache fails closed in arming.
        held[0x5b] |= self.win_forwarded[0];
        held[0x5c] |= self.win_forwarded[1];
        let mut inherited = [false; 256];
        inherited[0x5b] = self.win_suppressed[0];
        inherited[0x5c] = self.win_suppressed[1];
        let event = self
            .capture
            .begin(id, std::time::Instant::now(), held, inherited)?;
        // Transfer outstanding key-up ownership without retaining hotkey latches.
        self.down.fill(false);
        self.hold = false;
        self.toggle = false;
        self.rewrite = false;
        self.win_suppressed.fill(false);
        self.win_forwarded.fill(false);
        self.win_rearm.fill(true);
        self.capture_window = owner;
        Ok(event)
    }

    fn capture_event(
        &mut self,
        event: KeyEvent,
        focused: bool,
        now: std::time::Instant,
    ) -> Option<(KeyDecision, Option<ShortcutCaptureEvent>)> {
        let was_blocked = self.capture.blocked();
        let mut notification = self.capture.expire(now);
        if self.capture.active() && !focused {
            notification = self
                .capture
                .cancel("Shortcut capture ended because CridVoice lost focus.");
        }
        let capture = self
            .capture
            .update(sided_key(event), event.pressed, event.injected);
        (was_blocked || capture.handled).then_some((
            KeyDecision {
                swallow: capture.swallow,
                ..Default::default()
            },
            capture.event.or(notification),
        ))
    }

    fn update(
        &mut self,
        event: KeyEvent,
        shortcuts: &crate::config::Shortcuts,
        mut physically_down: impl FnMut(u16) -> bool,
    ) -> KeyDecision {
        let key = sided_key(event) as usize;
        if key >= self.down.len()
            || event.injected && (event.pressed || !MODIFIER_KEYS.contains(&(key as u16)))
        {
            return KeyDecision::default();
        }
        let previous_hold = self.hold;
        if event.injected {
            // A synthetic release may repair stale state but must never create
            // a shortcut. Own paste/Start-mask injections cannot start a take.
            match event.key {
                0x10 => {
                    self.down[0xa0] = false;
                    self.down[0xa1] = false;
                }
                0x11 => {
                    self.down[0xa2] = false;
                    self.down[0xa3] = false;
                }
                0x12 => {
                    self.down[0xa4] = false;
                    self.down[0xa5] = false;
                }
                _ => self.down[key] = false,
            }
            if matches!(key, 0x5b | 0x5c) {
                self.win_forwarded[key - 0x5b] = false;
            }
        } else {
            // The hook runs BEFORE the current key's async state is updated.
            // Only clear other cached modifiers, never adopt async downs.
            for modifier in MODIFIER_KEYS {
                let index = modifier as usize;
                let suppressed = matches!(index, 0x5b | 0x5c) && self.win_suppressed[index - 0x5b];
                if index != key && self.down[index] && !suppressed && !physically_down(modifier) {
                    self.down[index] = false;
                    if matches!(index, 0x5b | 0x5c) {
                        self.win_forwarded[index - 0x5b] = false;
                    }
                }
            }
            let rearmed = !matches!(key, 0x5b | 0x5c) || self.win_rearm[key - 0x5b];
            self.down[key] = event.pressed && rearmed;
        }
        let active = |value: &str| {
            parse_shortcut(value)
                .ok()
                .map(|s| {
                    (
                        matches(&s, &self.down),
                        !event.injected && event.pressed && shortcut_key(&s, key as u16),
                    )
                })
                .unwrap_or((false, false))
        };
        let (hold_match, hold_press) = active(&shortcuts.hold);
        let (toggle_match, toggle_press) = active(&shortcuts.toggle);
        let (rewrite_match, rewrite_press) = active(&shortcuts.rewrite);
        let hold = hold_match && (self.hold || hold_press);
        let toggle = toggle_match && (self.toggle || toggle_press);
        let rewrite = rewrite_match && (self.rewrite || rewrite_press);
        let action = if rewrite && !self.rewrite {
            Some(("toggle", true))
        } else if toggle && !self.toggle {
            Some(("toggle", false))
        } else if hold && !self.hold {
            Some(("start", false))
        } else if !hold && self.hold {
            Some(("stop", false))
        } else if !event.injected && key == VK_ESCAPE.0 as usize && event.pressed {
            Some(("cancel", false))
        } else {
            None
        };
        let cancel_start_menu = hold && !self.hold && self.win_forwarded.iter().any(|v| *v);
        let mut swallow = !event.injected && (toggle || rewrite) && event.pressed;
        if !event.injected && matches!(key, 0x5b | 0x5c) {
            let index = key - 0x5b;
            if event.pressed {
                // Once its down is suppressed, every repeat and its eventual
                // physical up must stay paired, even after the hold ends.
                if self.win_suppressed[index]
                    || (!self.win_forwarded[index] && (hold || previous_hold))
                {
                    self.win_suppressed[index] = true;
                    swallow = true;
                } else {
                    self.win_forwarded[index] = true;
                }
            } else {
                swallow = self.win_suppressed[index];
                self.win_suppressed[index] = false;
                self.win_forwarded[index] = false;
                self.win_rearm[index] = true;
            }
        }
        if previous_hold && !hold {
            for index in 0..2 {
                if self.win_suppressed[index] {
                    // Async state cannot verify a swallowed Windows down.
                    // Require its physical release before another hold; keep
                    // key-up ownership separate from shortcut matching state.
                    self.down[0x5b + index] = false;
                    self.win_rearm[index] = false;
                }
            }
        }
        self.hold = hold;
        self.toggle = toggle;
        self.rewrite = rewrite;
        KeyDecision {
            action,
            swallow,
            cancel_start_menu,
        }
    }
}
pub fn shortcut_action_current(epoch: u64) -> bool {
    KEYS.lock().unwrap().capture.action_current(epoch)
}
pub fn shortcut_capture_blocked() -> bool {
    KEYS.lock().unwrap().capture.blocked()
}
pub fn begin_shortcut_capture(id: String, owner: isize) -> Result<ShortcutCaptureEvent, String> {
    uuid::Uuid::parse_str(&id).map_err(|_| "Invalid shortcut capture id.".to_string())?;
    let mut keys = KEYS.lock().unwrap();
    if owner == 0 || unsafe { GetForegroundWindow().0 as isize } != owner {
        return Err("Keep CridVoice focused while capturing a shortcut.".into());
    }
    let mut held = [false; 256];
    for (key, value) in held.iter_mut().enumerate().take(255).skip(8) {
        // Generic modifier aliases do not have separate physical key-up events.
        if !matches!(key, 0x10..=0x12) {
            *value = unsafe { GetAsyncKeyState(key as i32) } < 0;
        }
    }
    keys.begin_capture(id, owner, held)
}
pub fn end_shortcut_capture(id: &str) -> Option<ShortcutCaptureEvent> {
    KEYS.lock().unwrap().capture.end(id, None)
}
pub fn cancel_shortcut_capture(only_if_unfocused: bool) -> Option<ShortcutCaptureEvent> {
    let mut keys = KEYS.lock().unwrap();
    if only_if_unfocused && unsafe { GetForegroundWindow().0 as isize } == keys.capture_window {
        return None;
    }
    keys.capture
        .cancel("Shortcut capture ended because CridVoice lost focus.")
}
pub fn expire_shortcut_capture(id: &str) -> Option<ShortcutCaptureEvent> {
    let mut keys = KEYS.lock().unwrap();
    if keys.capture.id() == Some(id) {
        keys.capture.expire(std::time::Instant::now())
    } else {
        None
    }
}
fn matches(s: &Shortcut, d: &[bool; 256]) -> bool {
    let ctrl = d[0xa2] || d[0xa3] || d[0x11];
    let alt = d[0xa4] || d[0xa5] || d[0x12];
    let shift = d[0xa0] || d[0xa1] || d[0x10];
    let win = d[0x5b] || d[0x5c];
    ctrl == s.ctrl
        && alt == s.alt
        && shift == s.shift
        && win == s.super_key
        && s.key.map(|k| d[k as usize]).unwrap_or(true)
}
#[cfg(test)]
mod shortcut_tests {
    use super::*;

    struct Keyboard {
        state: KeyState,
        physical: [bool; 256],
    }
    impl Keyboard {
        fn new() -> Self {
            Self {
                state: KeyState::new(),
                physical: [false; 256],
            }
        }
        fn event(&mut self, key: u16, pressed: bool, injected: bool) -> KeyDecision {
            let event = KeyEvent {
                key,
                scan: 0,
                extended: false,
                pressed,
                injected,
            };
            // Windows reports the current key's OLD state inside the callback.
            let result = self
                .state
                .update(event, &Default::default(), |k| self.physical[k as usize]);
            if !injected && !result.swallow {
                self.physical[key as usize] = pressed;
            }
            result
        }
        fn down(&mut self, key: u16) -> KeyDecision {
            self.event(key, true, false)
        }
        fn up(&mut self, key: u16) -> KeyDecision {
            self.event(key, false, false)
        }
    }

    #[test]
    fn modifiers_alone_never_start() {
        for key in [0xa2, 0xa3, 0x5b, 0x5c] {
            let mut k = Keyboard::new();
            assert_eq!(k.down(key).action, None);
            assert_eq!(k.down(key).action, None);
            assert_eq!(k.up(key).action, None);
        }
    }

    #[test]
    fn both_sides_press_and_release_orders_preserve_one_start_stop() {
        for ctrl in [0xa2, 0xa3] {
            for win in [0x5b, 0x5c] {
                for win_first in [false, true] {
                    for win_up_first in [false, true] {
                        let mut k = Keyboard::new();
                        let (first, second) = if win_first { (win, ctrl) } else { (ctrl, win) };
                        assert_eq!(k.down(first), KeyDecision::default());
                        let start = k.down(second);
                        assert_eq!(start.action, Some(("start", false)));
                        assert_eq!(start.cancel_start_menu, win_first);
                        assert_eq!(start.swallow, !win_first);
                        assert_eq!(k.down(second).action, None);
                        let (first_up, second_up) = if win_up_first {
                            (win, ctrl)
                        } else {
                            (ctrl, win)
                        };
                        let stop = k.up(first_up);
                        assert_eq!(stop.action, Some(("stop", false)));
                        assert_eq!(stop.swallow, !win_first && win_up_first);
                        let end = k.up(second_up);
                        assert_eq!(end.action, None);
                        assert_eq!(end.swallow, !win_first && !win_up_first);
                        assert!(!k.state.hold);
                    }
                }
            }
        }
    }

    #[test]
    fn missed_forwarded_windows_release_cannot_turn_ctrl_into_shortcut() {
        let mut k = Keyboard::new();
        k.down(0x5b);
        k.physical[0x5b] = false; // Key-up was not delivered to our hook.
        assert_eq!(k.down(0xa2).action, None);
        assert!(!k.state.down[0x5b]);
        assert!(!k.state.win_forwarded[0]);
    }

    #[test]
    fn forwarded_windows_repeats_never_steal_its_release() {
        let mut k = Keyboard::new();
        k.down(0x5b);
        k.down(0xa2);
        assert_eq!(k.down(0x5b), KeyDecision::default());
        assert!(!k.state.win_suppressed[0]);
        let release = k.up(0x5b);
        assert_eq!(release.action, Some(("stop", false)));
        assert!(!release.swallow);
        assert!(!k.physical[0x5b]);
        let mut k = Keyboard::new();
        k.down(0x5b);
        k.down(0xa2);
        k.up(0xa2);
        assert_eq!(k.down(0x5b), KeyDecision::default());
        assert!(!k.up(0x5b).swallow);
    }

    #[test]
    fn missed_windows_release_after_take_cannot_start_from_ctrl_alone() {
        for win_first in [false, true] {
            let mut k = Keyboard::new();
            k.down(if win_first { 0x5b } else { 0xa2 });
            assert_eq!(
                k.down(if win_first { 0xa2 } else { 0x5b }).action,
                Some(("start", false))
            );
            k.physical[0x5b] = false;
            assert_eq!(k.up(0xa2).action, Some(("stop", false)));
            assert_eq!(k.down(0xa2).action, None);
        }
    }

    #[test]
    fn suppressed_windows_repeat_stays_paired_until_physical_release() {
        let mut k = Keyboard::new();
        k.down(0xa2);
        k.down(0x5b);
        assert!(!k.physical[0x5b]);
        assert_eq!(k.down(0x41).action, None);
        assert!(k.state.hold);
        assert_eq!(k.up(0xa2).action, Some(("stop", false)));
        let repeat = k.down(0x5b);
        assert!(repeat.swallow);
        assert_eq!(repeat.action, None);
        assert_eq!(k.down(0xa2).action, None);
        assert!(k.up(0x5b).swallow);
        k.up(0xa2);
        k.down(0xa2);
        assert_eq!(k.down(0x5b).action, Some(("start", false)));
    }

    #[test]
    fn injected_downs_and_own_start_mask_are_noops() {
        let mut k = Keyboard::new();
        assert_eq!(k.event(0x5b, true, true), KeyDecision::default());
        assert_eq!(k.down(0xa2).action, None);
        k.down(0x5b);
        // The current Ctrl async state can still be old during reentrant input.
        k.physical[0xa2] = false;
        for pressed in [true, false] {
            assert_eq!(k.event(0xff, pressed, true), KeyDecision::default());
        }
        assert!(k.state.hold);
    }

    #[test]
    fn injected_modifier_releases_can_only_stop() {
        for release in [0x11, 0xa2, 0x5b] {
            let mut k = Keyboard::new();
            k.down(0xa2);
            k.down(0x5b);
            assert_eq!(k.event(release, false, true).action, Some(("stop", false)));
            assert_eq!(k.event(release, false, true).action, None);
            assert_eq!(k.down(0xa2).action, None);
            assert!(k.up(0x5b).swallow);
        }
    }

    #[test]
    fn removing_extra_modifier_does_not_start_or_latch_recording() {
        for injected in [false, true] {
            let mut k = Keyboard::new();
            k.down(0xa4);
            k.down(0xa2);
            k.down(0x5b);
            assert_eq!(k.event(0xa4, false, injected).action, None);
            assert!(!k.state.hold);
            assert_eq!(k.down(0x41).action, None);
        }
    }

    #[test]
    fn modifier_sides_are_normalized_and_release_independently() {
        assert_eq!(
            sided_key(KeyEvent {
                key: 0x11,
                scan: 0,
                extended: true,
                pressed: true,
                injected: false
            }),
            0xa3
        );
        assert_eq!(
            sided_key(KeyEvent {
                key: 0x10,
                scan: 0x36,
                extended: false,
                pressed: true,
                injected: false
            }),
            0xa1
        );
        let mut k = Keyboard::new();
        k.down(0xa2);
        k.down(0xa3);
        k.down(0x5b);
        assert_eq!(k.up(0xa2).action, None);
        assert_eq!(k.up(0xa3).action, Some(("stop", false)));
        let mut state = KeyState::new();
        let generic_ctrl = KeyEvent {
            key: 0x11,
            scan: 0,
            extended: true,
            pressed: true,
            injected: false,
        };
        assert_eq!(
            state
                .update(generic_ctrl, &Default::default(), |_| false)
                .action,
            None
        );
        assert!(state.down[0xa3]);
        assert!(!state.down[0x11]);
        assert_eq!(
            state
                .update(
                    KeyEvent {
                        key: 0x5c,
                        ..generic_ctrl
                    },
                    &Default::default(),
                    |k| k == 0xa3
                )
                .action,
            Some(("start", false))
        );
        assert_eq!(
            state
                .update(
                    KeyEvent {
                        pressed: false,
                        ..generic_ctrl
                    },
                    &Default::default(),
                    |_| false
                )
                .action,
            Some(("stop", false))
        );
    }

    #[test]
    fn toggle_and_rewrite_debounce_then_retrigger() {
        for (modifier, key, rewrite) in [(0xa0, 0x20, false), (0xa4, 0x52, true)] {
            let mut k = Keyboard::new();
            k.down(0xa2);
            k.down(modifier);
            for _ in 0..2 {
                let result = k.down(key);
                assert_eq!(result.action, Some(("toggle", rewrite)));
                assert!(result.swallow);
                assert_eq!(k.down(key).action, None);
                assert_eq!(k.up(key).action, None);
            }
        }
    }
    fn captured(
        state: &mut KeyState,
        key: u16,
        pressed: bool,
        focused: bool,
    ) -> (KeyDecision, Option<ShortcutCaptureEvent>) {
        state
            .capture_event(
                KeyEvent {
                    key,
                    scan: 0,
                    extended: false,
                    pressed,
                    injected: false,
                },
                focused,
                std::time::Instant::now(),
            )
            .unwrap()
    }
    #[test]
    fn hook_capture_transfers_old_release_ownership_and_clears_matching_latches() {
        for win_first in [false, true] {
            let mut k = Keyboard::new();
            k.down(if win_first { 0x5b } else { 0xa2 });
            k.down(if win_first { 0xa2 } else { 0x5b });
            assert!(k.state.hold);
            let queued_epoch = k.state.capture.epoch();
            k.state
                .begin_capture("capture".into(), 1, k.physical)
                .unwrap();
            assert!(!k.state.hold);
            assert!(!k.state.down.iter().any(|v| *v));
            let (release, _) = captured(&mut k.state, 0x5b, false, true);
            assert_eq!(release.swallow, !win_first);
            assert_eq!(release.action, None);
            assert!(!captured(&mut k.state, 0xa2, false, true).0.swallow);
            captured(&mut k.state, 0xa2, true, true);
            captured(&mut k.state, 0x5b, true, true);
            captured(&mut k.state, 0xa2, false, true);
            let (decision, event) = captured(&mut k.state, 0x5b, false, true);
            assert_eq!(decision.action, None);
            assert_eq!(event.unwrap().phase, "complete");
            k.state.capture.end("capture", None).unwrap();
            assert!(!k.state.capture.action_current(queued_epoch));
            let ctrl = KeyEvent {
                key: 0xa2,
                scan: 0,
                extended: false,
                pressed: true,
                injected: false,
            };
            assert_eq!(
                k.state.update(ctrl, &Default::default(), |_| false).action,
                None
            );
        }
    }
    #[test]
    fn hook_focus_loss_cancels_and_drains_without_any_dictation_action() {
        let mut state = KeyState::new();
        state
            .begin_capture("capture".into(), 1, [false; 256])
            .unwrap();
        captured(&mut state, 0xa2, true, true);
        captured(&mut state, 0x5b, true, true);
        let (decision, event) = captured(&mut state, 0x41, true, false);
        assert_eq!(decision.action, None);
        assert_eq!(event.unwrap().phase, "cancelled");
        assert!(!state.capture.active());
        for key in [0xa2, 0x5b, 0x41] {
            assert_eq!(captured(&mut state, key, false, false).0.action, None);
        }
        assert!(!state.capture.blocked());
        assert!(!state.down.iter().any(|v| *v));
    }
}
unsafe extern "system" fn hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let event = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        if event.vkCode < 256 {
            let pressed = wparam.0 as u32 == WM_KEYDOWN || wparam.0 as u32 == WM_SYSKEYDOWN;
            if let Some(app) = APP.get() {
                let state = app.state::<desktop::State>();
                let shortcuts = state.shortcuts.lock().unwrap().clone();
                let key_event = KeyEvent {
                    key: event.vkCode as u16,
                    scan: event.scanCode,
                    extended: event.flags.0 & LLKHF_EXTENDED.0 != 0,
                    pressed,
                    injected: event.flags.0 & LLKHF_INJECTED.0 != 0,
                };
                let (decision, capture_event, epoch) = {
                    let mut keys = KEYS.lock().unwrap();
                    let focused = !keys.capture.active()
                        || GetForegroundWindow().0 as isize == keys.capture_window;
                    let capture = keys.capture_event(key_event, focused, std::time::Instant::now());
                    let epoch = keys.capture.epoch();
                    if let Some((decision, notification)) = capture {
                        (decision, notification, epoch)
                    } else {
                        (
                            keys.update(key_event, &shortcuts, |key| {
                                GetAsyncKeyState(key as i32) < 0
                            }),
                            None,
                            epoch,
                        )
                    }
                };
                if let Some(event) = capture_event {
                    let _ = app.emit_to("main", "shortcut-capture", event);
                }
                // If Windows was pressed first, it already reached the OS. An
                // unassigned key cancels Start, then its real key-up must pass
                // through so Windows never remains logically held down.
                if decision.cancel_start_menu {
                    let input = [
                        KEYEVENTF_EXTENDEDKEY,
                        KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP,
                    ]
                    .map(|flags| INPUT {
                        r#type: INPUT_KEYBOARD,
                        Anonymous: INPUT_0 {
                            ki: KEYBDINPUT {
                                wVk: VIRTUAL_KEY(0xff),
                                wScan: 0,
                                dwFlags: flags,
                                time: 0,
                                dwExtraInfo: 0,
                            },
                        },
                    });
                    let _ = SendInput(&input, std::mem::size_of::<INPUT>() as i32);
                }
                if let Some((action, rewrite)) = decision.action {
                    desktop::dispatch_shortcut(app.clone(), action, rewrite, true, epoch);
                }
                if decision.swallow {
                    return LRESULT(1);
                }
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}
pub fn install_shortcuts(app: &AppHandle) -> Result<(), String> {
    let _ = APP.set(app.clone());
    // Create the apartment/client while the app starts, without inspecting any
    // other application's contents. First dictation can use the warmed worker.
    let _ = focus_worker();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || unsafe {
        let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook), None, 0);
        if let Ok(hook) = hook {
            let _ = tx.send(Ok(()));
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            let _ = UnhookWindowsHookEx(hook);
        } else {
            let _ = tx.send(Err(
                "Windows could not register the dictation keyboard hook.".to_string(),
            ));
        }
    });
    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "Keyboard shortcut initialization timed out.".to_string())?
}
pub fn startup_error(message: &str) {
    unsafe {
        let _ = MessageBoxW(
            None,
            &windows::core::HSTRING::from(message),
            &windows::core::HSTRING::from("CridVoice"),
            MB_OK | MB_ICONERROR,
        );
    }
}
fn app_name(hwnd: HWND) -> String {
    unsafe {
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            let mut buf = [0u16; 2048];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                windows::core::PWSTR(buf.as_mut_ptr()),
                &mut len,
            )
            .is_ok();
            let _ = CloseHandle(handle);
            if ok {
                return std::path::Path::new(&String::from_utf16_lossy(&buf[..len as usize]))
                    .file_stem()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
            }
        }
        String::new()
    }
}
pub fn context(read_text: bool) -> Context {
    context_for_output(read_text, false)
}
pub fn context_for_output(read_text: bool, technical: bool) -> Context {
    capture_target_with_retry(
        || capture_context(read_text, technical, true, &[]),
        std::thread::sleep,
    )
}
fn capture_target_with_retry(
    mut sample: impl FnMut() -> Context,
    mut pause: impl FnMut(std::time::Duration),
) -> Context {
    let mut context = sample();
    let original_window = context.hwnd;
    for _ in 1..FOCUS_PROBE_ATTEMPTS {
        if context.hwnd == 0 || context.password || !context.focused_runtime_id.is_empty() {
            break;
        }
        // The first accessibility request can be cold, especially in Chromium.
        // Let it settle without adopting a different foreground window.
        pause(FOCUS_PROBE_DELAY);
        context = sample();
        if context.hwnd != original_window {
            context.hwnd = 0;
            context.selected.clear();
            context.nearby.clear();
            context.window_title.clear();
            break;
        }
    }
    context
}
fn insertion_context(target: &Context) -> Context {
    // Insertion needs fresh focus and password checks, never another process
    // image lookup or the target's text/title. This also keeps every batch small.
    capture_context(false, false, false, &target.focused_runtime_id)
}

const FOCUS_REQUEST_TIMEOUT: Duration = Duration::from_millis(500);
static FOCUS_WORKER: OnceLock<Option<SyncSender<FocusRequest>>> = OnceLock::new();

struct FocusRequest {
    hwnd: isize,
    read_text: bool,
    technical: bool,
    identify_app: bool,
    expected_id: Vec<i32>,
    needed: Arc<AtomicBool>,
    reply: SyncSender<Context>,
}

fn focus_worker() -> Option<&'static SyncSender<FocusRequest>> {
    FOCUS_WORKER
        .get_or_init(|| {
            // At most one waiting request. A stuck provider cannot accumulate
            // work or make a later take consume an old focus response.
            let (sender, receiver) = mpsc::sync_channel::<FocusRequest>(1);
            std::thread::Builder::new()
                .name("input-focus".into())
                .spawn(move || unsafe {
                    if CoInitializeEx(None, COINIT_MULTITHREADED).is_err() {
                        return;
                    }
                    struct Apartment;
                    impl Drop for Apartment {
                        fn drop(&mut self) {
                            unsafe { CoUninitialize() };
                        }
                    }
                    let _apartment = Apartment;
                    let Ok(ui) = CoCreateInstance::<_, IUIAutomation>(
                        &CUIAutomation8,
                        None,
                        CLSCTX_INPROC_SERVER,
                    )
                    .or_else(|_| CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)) else {
                        return;
                    };
                    if let Ok(options) = ui.cast::<IUIAutomation2>() {
                        let _ = options.SetConnectionTimeout(200);
                        let _ = options.SetTransactionTimeout(200);
                    }
                    // Keep both the client apartment and original provider
                    // alive for the take. Recreating them between capture and
                    // insertion can invalidate Chromium accessibility nodes.
                    let mut original: Option<(Vec<i32>, IUIAutomationElement)> = None;
                    while let Ok(request) = receiver.recv() {
                        if !request.needed.load(Ordering::Acquire) {
                            continue;
                        }
                        let (context, element) = sample_context(&ui, &request, original.as_ref());
                        if request.needed.load(Ordering::Acquire) {
                            if request.identify_app && !context.focused_runtime_id.is_empty() {
                                original = element.map(|element| (context.focused_runtime_id.clone(), element));
                            }
                            let _ = request.reply.send(context);
                        }
                    }
                })
                .ok()
                .map(|_| sender)
        })
        .as_ref()
}

fn capture_context(
    read_text: bool,
    technical: bool,
    identify_app: bool,
    expected_id: &[i32],
) -> Context {
    let hwnd = unsafe { GetForegroundWindow().0 as isize };
    let Some(sender) = focus_worker() else {
        return Context::default();
    };
    let (reply, result) = mpsc::sync_channel(1);
    let needed = Arc::new(AtomicBool::new(true));
    let request = FocusRequest {
        hwnd,
        read_text,
        technical,
        identify_app,
        expected_id: expected_id.to_vec(),
        needed: needed.clone(),
        reply,
    };
    let response = if sender.try_send(request).is_ok() {
        result.recv_timeout(FOCUS_REQUEST_TIMEOUT).ok()
    } else {
        None
    };
    needed.store(false, Ordering::Release);
    context_after_focus_response(response, hwnd, unsafe { GetForegroundWindow().0 as isize })
}

fn context_after_focus_response(
    response: Option<Context>,
    requested_window: isize,
    current_window: isize,
) -> Context {
    match response {
        // A real UIA rejection, including HWND=0, must remain rejected.
        Some(context) => context,
        // A cold/busy worker has not observed a field at all. Preserve only
        // independently rechecked window metadata so bounded capture retries
        // can use the warmed worker. Empty identity still forbids insertion.
        None if requested_window != 0 && current_window == requested_window => Context {
            hwnd: requested_window,
            ..Default::default()
        },
        None => Context::default(),
    }
}

unsafe fn sample_context(
    ui: &IUIAutomation,
    request: &FocusRequest,
    original: Option<&(Vec<i32>, IUIAutomationElement)>,
) -> (Context, Option<IUIAutomationElement>) {
    unsafe {
        let hwnd = HWND(request.hwnd as *mut _);
        let mut ctx = Context {
            app: if request.identify_app {
                app_name(hwnd)
            } else {
                String::new()
            },
            hwnd: hwnd.0 as isize,
            ..Default::default()
        };
        if hwnd.0.is_null() || GetForegroundWindow() != hwnd {
            ctx.hwnd = 0;
            return (ctx, None);
        }
        let mut retained = None;
        if let Ok(focused) = ui.GetFocusedElement() {
            if let Some(element) = canonical_input(ui, &focused, hwnd) {
                ctx.password = focused
                    .CurrentIsPassword()
                    .map(|v| v.as_bool())
                    .unwrap_or(true);
                ctx.password = element
                    .CurrentIsPassword()
                    .map(|v| v.as_bool())
                    .unwrap_or(true)
                    || ctx.password;
                if let Ok(id) = element.GetRuntimeId() {
                    ctx.focused_runtime_id = safe_array_i32(id);
                    let _ = SafeArrayDestroy(id);
                }
                if request.identify_app || ctx.focused_runtime_id != request.expected_id {
                    ctx.focus_anchor = stable_anchor(ui, &element);
                    ctx.focus_anchor.original_unavailable = original
                        .filter(|(id, _)| *id == request.expected_id)
                        .is_some_and(|(_, old)| {
                            replacement_error_proves_removal(
                                old.CurrentIsEnabled()
                                    .err()
                                    .map(|error| error.code().0 as u32),
                            )
                        });
                }
                retained = Some(element.clone());
                if request.read_text && !ctx.password && !ctx.focused_runtime_id.is_empty() {
                    if GetForegroundWindow() == hwnd {
                        let mut title = [0u16; 257];
                        let length = GetWindowTextW(hwnd, &mut title);
                        if length > 0 {
                            ctx.window_title = String::from_utf16_lossy(&title[..length as usize]);
                        }
                    }
                    if let Ok(pattern) = element.GetCurrentPattern(UIA_TextPatternId) {
                        if let Ok(text) = pattern.cast::<IUIAutomationTextPattern>() {
                            if let Ok(selection) = text.GetSelection() {
                                if selection.Length().unwrap_or(0) > 0 {
                                    if let Ok(range) = selection.GetElement(0) {
                                        ctx.selected = range
                                            .GetText(2048)
                                            .map(|b| b.to_string())
                                            .unwrap_or_default();
                                    }
                                }
                            }
                            ctx.nearby = text
                                .DocumentRange()
                                .and_then(|r| {
                                    if request.technical {
                                        // Read the recent terminal/editor tail, not an old
                                        // shell prompt at the start of a long scrollback.
                                        let tail = r.Clone()?;
                                        tail.MoveEndpointByRange(
                                            TextPatternRangeEndpoint_Start,
                                            &r,
                                            TextPatternRangeEndpoint_End,
                                        )?;
                                        tail.MoveEndpointByUnit(
                                            TextPatternRangeEndpoint_Start,
                                            TextUnit_Character,
                                            -2048,
                                        )?;
                                        tail.GetText(2048)
                                    } else {
                                        r.GetText(2048)
                                    }
                                })
                                .map(|b| b.to_string())
                                .unwrap_or_default();
                        }
                    } else if let Ok(pattern) = element.GetCurrentPattern(UIA_ValuePatternId) {
                        if let Ok(value) = pattern.cast::<IUIAutomationValuePattern>() {
                            ctx.nearby = value
                                .CurrentValue()
                                .map(|b| {
                                    let value = b.to_string();
                                    if request.technical {
                                        value
                                            .chars()
                                            .rev()
                                            .take(2048)
                                            .collect::<Vec<_>>()
                                            .into_iter()
                                            .rev()
                                            .collect()
                                    } else {
                                        value.chars().take(2048).collect()
                                    }
                                })
                                .unwrap_or_default()
                        }
                    }
                }
            }
        }
        if GetForegroundWindow() != hwnd {
            // A UIA response sampled across a foreground change cannot describe
            // a trustworthy input target, even if the old HWND is still alive.
            ctx.hwnd = 0;
            ctx.selected.clear();
            ctx.nearby.clear();
            ctx.window_title.clear();
        }
        (ctx, retained)
    }
}

unsafe fn canonical_input(
    ui: &IUIAutomation,
    focused: &IUIAutomationElement,
    foreground: HWND,
) -> Option<IUIAutomationElement> {
    let walker = ui.RawViewWalker().ok()?;
    let started = Instant::now();
    let leaf_type = focused.CurrentControlType().ok()?;
    // A focused text fragment can move as the caret advances. Normalize only
    // such fragments to their nearest actual editor, never buttons/links or a
    // second nested editor to a shared page/document container.
    let may_normalize = [
        UIA_TextControlTypeId,
        UIA_GroupControlTypeId,
        UIA_CustomControlTypeId,
    ]
    .contains(&leaf_type);
    let mut found_editor = editing_host(focused, leaf_type);
    let mut candidate =
        (found_editor || direct_text_input(focused, leaf_type)).then(|| focused.clone());
    let mut element = focused.clone();
    for _ in 0..32 {
        if started.elapsed() >= Duration::from_millis(200) {
            return None;
        }
        let kind = element.CurrentControlType().ok()?;
        if may_normalize && !found_editor && editing_host(&element, kind) {
            candidate = Some(element.clone());
            found_editor = true;
        }
        let native = element.CurrentNativeWindowHandle().ok()?;
        if !native.0.is_null() {
            let root = GetAncestor(native, GA_ROOT);
            if root == foreground {
                return candidate;
            }
            // A nonzero native ancestor in a different top-level window means
            // global UIA focus and Win32 foreground are an inconsistent pair.
            if !root.0.is_null() {
                return None;
            }
        }
        element = walker.GetParentElement(&element).ok()?;
    }
    None
}

unsafe fn editing_host(element: &IUIAutomationElement, kind: UIA_CONTROLTYPE_ID) -> bool {
    kind == UIA_EditControlTypeId
        || kind == UIA_DocumentControlTypeId
            && element.GetCurrentPattern(UIA_TextEditPatternId).is_ok()
        || [UIA_CustomControlTypeId, UIA_ComboBoxControlTypeId].contains(&kind)
            && element
                .GetCurrentPattern(UIA_ValuePatternId)
                .and_then(|pattern| pattern.cast::<IUIAutomationValuePattern>())
                .and_then(|value| value.CurrentIsReadOnly())
                .is_ok_and(|read_only| !read_only.as_bool())
}

unsafe fn direct_text_input(element: &IUIAutomationElement, kind: UIA_CONTROLTYPE_ID) -> bool {
    // Terminals and some editors expose a focused Document/TextPattern rather
    // than Value/TextEdit. A button, link or unrelated page container cannot
    // become an input target merely by sharing the application's window.
    [
        UIA_DocumentControlTypeId,
        UIA_CustomControlTypeId,
        UIA_TextControlTypeId,
        UIA_PaneControlTypeId,
    ]
    .contains(&kind)
        && element
            .CurrentHasKeyboardFocus()
            .is_ok_and(|value| value.as_bool())
        && element
            .CurrentIsKeyboardFocusable()
            .is_ok_and(|value| value.as_bool())
        && element.GetCurrentPattern(UIA_TextPatternId).is_ok()
}

unsafe fn element_runtime_id(element: &IUIAutomationElement) -> Vec<i32> {
    let Ok(id) = element.GetRuntimeId() else {
        return vec![];
    };
    let result = safe_array_i32(id);
    let _ = SafeArrayDestroy(id);
    result
}

unsafe fn stable_anchor(ui: &IUIAutomation, element: &IUIAutomationElement) -> FocusAnchor {
    let mut anchor = FocusAnchor {
        process_id: element.CurrentProcessId().unwrap_or_default(),
        control_type: element
            .CurrentControlType()
            .map(|kind| kind.0)
            .unwrap_or_default(),
        ..Default::default()
    };
    if ![UIA_EditControlTypeId, UIA_DocumentControlTypeId]
        .contains(&UIA_CONTROLTYPE_ID(anchor.control_type))
    {
        return anchor;
    }
    let Ok(id) = element.CurrentAutomationId() else {
        return anchor;
    };
    let id = id.to_string();
    if id.is_empty() || id.len() > 512 || anchor.process_id <= 0 {
        return anchor;
    }
    let Ok(walker) = ui.RawViewWalker() else {
        return anchor;
    };
    let Ok(parent) = walker.GetParentElement(element) else {
        return anchor;
    };
    anchor.parent_runtime_id = element_runtime_id(&parent);
    if anchor.parent_runtime_id.is_empty() {
        return anchor;
    }
    // AutomationId is scoped to raw siblings. Prove uniqueness on both capture
    // and replacement, not by a name, placeholder, screen position or ID prefix.
    let Ok(condition) = ui.CreateTrueCondition() else {
        return anchor;
    };
    let Ok(children) = parent.FindAll(TreeScope_Children, &condition) else {
        return anchor;
    };
    let Ok(length) = children.Length() else {
        return anchor;
    };
    if !(1..=128).contains(&length) {
        return anchor;
    }
    let started = Instant::now();
    let mut matches = 0;
    for index in 0..length {
        if started.elapsed() >= Duration::from_millis(150) {
            return anchor;
        }
        let Ok(child) = children.GetElement(index) else {
            return anchor;
        };
        let Ok(child_id) = child.CurrentAutomationId() else {
            return anchor;
        };
        if child_id == id {
            matches += 1;
            if matches > 1 {
                return anchor;
            }
        }
    }
    if matches == 1 {
        anchor.automation_id = id;
        anchor.unique_in_parent = true;
    }
    anchor
}

fn verified_recreated_field(target: &FocusAnchor, current: &FocusAnchor) -> bool {
    current.original_unavailable
        && [UIA_EditControlTypeId, UIA_DocumentControlTypeId]
            .contains(&UIA_CONTROLTYPE_ID(target.control_type))
        && target.unique_in_parent
        && current.unique_in_parent
        && target.process_id > 0
        && target.process_id == current.process_id
        && target.control_type == current.control_type
        && !target.automation_id.is_empty()
        && target.automation_id == current.automation_id
        && !target.parent_runtime_id.is_empty()
        && target.parent_runtime_id == current.parent_runtime_id
}

fn replacement_error_proves_removal(error: Option<u32>) -> bool {
    error == Some(UIA_E_ELEMENTNOTAVAILABLE)
}

unsafe fn safe_array_i32(array: *mut SAFEARRAY) -> Vec<i32> {
    if array.is_null() || SafeArrayGetDim(array) != 1 {
        return vec![];
    }
    let (Ok(lo), Ok(hi)) = (SafeArrayGetLBound(array, 1), SafeArrayGetUBound(array, 1)) else {
        return vec![];
    };
    let mut result = vec![];
    for i in lo..=hi {
        let mut v = 0i32;
        if SafeArrayGetElement(array, &i, (&mut v as *mut i32).cast()).is_err() {
            // A partial identity could collide with another field. Reject the
            // complete snapshot if any element could not be read.
            return vec![];
        }
        result.push(v)
    }
    result
}
pub fn insert(
    text: &str,
    target: &Context,
    method: &str,
    app: &AppHandle,
    active: &dyn Fn() -> bool,
) -> Result<(), String> {
    if !active() {
        return Err("Dictation was cancelled.".into());
    }
    if target.password {
        return Err("Text insertion into password fields is disabled.".into());
    }
    if target.app.eq_ignore_ascii_case("cridvoice") {
        return Err(
            "Use a dictation shortcut with another application focused, or copy the result.".into(),
        );
    }
    wait_for_modifier_release(active)?;
    validate_current_insertion_target(target, active)?;
    if method == "clipboard" {
        return crate::clipboard::with_unicode_fallback(
            || crate::clipboard::paste(text, target, app, active),
            || {
                // A delayed clipboard format may take time to render. Recheck
                // modifiers and the original target before the fallback types.
                wait_for_modifier_release(active)?;
                type_unicode_batches(
                    text,
                    target,
                    active,
                    || insertion_context(target),
                    send_unicode,
                )
            },
        );
    }
    type_unicode_batches(
        text,
        target,
        active,
        || insertion_context(target),
        send_unicode,
    )
}

const FOCUS_PROBE_ATTEMPTS: usize = 5;
const FOCUS_PROBE_DELAY: std::time::Duration = std::time::Duration::from_millis(20);

pub(crate) fn validate_current_insertion_target(
    target: &Context,
    active: &dyn Fn() -> bool,
) -> Result<(), String> {
    validate_target_with_retry(
        target,
        active,
        || insertion_context(target),
        std::thread::sleep,
    )
}

fn validate_target_with_retry(
    target: &Context,
    active: &dyn Fn() -> bool,
    mut sample: impl FnMut() -> Context,
    mut pause: impl FnMut(std::time::Duration),
) -> Result<(), String> {
    for attempt in 0..FOCUS_PROBE_ATTEMPTS {
        if !active() {
            return Err("Dictation was cancelled.".into());
        }
        let current = sample();
        if !active() {
            return Err("Dictation was cancelled.".into());
        }
        match validate_insertion_target(target, &current) {
            Ok(()) => return Ok(()),
            Err(error) => {
                // A provider can briefly expose no node or an intermediate
                // node. Retry only inside the original foreground window;
                // each fresh sample must independently prove the same field.
                let can_settle = !target.password
                    && !current.password
                    && target.hwnd != 0
                    && current.hwnd == target.hwnd
                    && !target.focused_runtime_id.is_empty();
                if !can_settle || attempt + 1 == FOCUS_PROBE_ATTEMPTS {
                    // Fixed categories/counts only. No text, title, URL,
                    // AutomationId or runtime identifier is written to stderr.
                    eprintln!(
                        "CridVoice focus: window_matches={} original_id_present={} current_id_present={} original_control={} current_control={} original_anchor_unique={} current_anchor_unique={} original_removed={}",
                        target.hwnd == current.hwnd,
                        !target.focused_runtime_id.is_empty(),
                        !current.focused_runtime_id.is_empty(),
                        target.focus_anchor.control_type,
                        current.focus_anchor.control_type,
                        target.focus_anchor.unique_in_parent,
                        current.focus_anchor.unique_in_parent,
                        current.focus_anchor.original_unavailable,
                    );
                    return Err(error);
                }
                pause(FOCUS_PROBE_DELAY);
            }
        }
    }
    unreachable!("focus probe always returns within its bounded attempts")
}

pub(crate) fn validate_insertion_target(target: &Context, current: &Context) -> Result<(), String> {
    if target.password || current.password {
        return Err("Text insertion into password fields is disabled.".into());
    }
    if target.hwnd == 0 || current.hwnd == 0 {
        return Err("The input window is unavailable. Your text is available to copy.".into());
    }
    if current.hwnd != target.hwnd {
        return Err(
            "Focus changed to another window before insertion. Your text is available to copy."
                .into(),
        );
    }
    if target.focused_runtime_id.is_empty() {
        return Err(
            "The original text field could not be verified. Your text is available to copy.".into(),
        );
    }
    if current.focused_runtime_id != target.focused_runtime_id
        && !(!current.focused_runtime_id.is_empty()
            && verified_recreated_field(&target.focus_anchor, &current.focus_anchor))
    {
        return Err(if current.focused_runtime_id.is_empty() {
            "The focused text field could not be verified. Your text is available to copy."
        } else {
            "Focus changed to another field before insertion. Your text is available to copy."
        }
        .into());
    }
    Ok(())
}

fn wait_for_modifier_release(active: &dyn Fn() -> bool) -> Result<(), String> {
    // Wait for physical modifiers to be released before injecting input.
    for _ in 0..60 {
        if !active() {
            return Err("Dictation was cancelled.".into());
        }
        let held = unsafe {
            [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN]
                .iter()
                .any(|k| GetAsyncKeyState(k.0 as i32) < 0)
        };
        if !held {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    let held = unsafe {
        [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN]
            .iter()
            .any(|k| GetAsyncKeyState(k.0 as i32) < 0)
    };
    if held {
        return Err(
            "Release modifier keys before insertion. Your text is available to copy.".into(),
        );
    }
    Ok(())
}

fn send_unicode(batch: &[INPUT]) -> u32 {
    unsafe { SendInput(batch, std::mem::size_of::<INPUT>() as i32) }
}

fn unicode_inputs(text: &str) -> Vec<INPUT> {
    let normalized = text.replace("\r\n", "\n");
    let mut inputs = Vec::new();
    for unit in normalized.encode_utf16() {
        for flags in [KEYEVENTF_UNICODE, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP] {
            inputs.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(0),
                        wScan: unit,
                        dwFlags: flags,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            })
        }
    }
    inputs
}

fn type_unicode_batches(
    text: &str,
    target: &Context,
    active: &dyn Fn() -> bool,
    mut current_context: impl FnMut() -> Context,
    mut send: impl FnMut(&[INPUT]) -> u32,
) -> Result<(), String> {
    let mut input_started = false;
    for batch in unicode_inputs(text).chunks(64) {
        if !active() {
            return Err(insertion_error("Dictation was cancelled.", input_started));
        }
        // Do not send the remainder to a new window, field or password input.
        validate_target_with_retry(target, active, &mut current_context, std::thread::sleep)
            .map_err(|error| insertion_error(&error, input_started))?;
        let sent = crate::controller::run_if_active(active, || send(batch))
            .map_err(|error| insertion_error(&error, input_started))?;
        if sent != batch.len() as u32 {
            let partially_inserted = input_started || sent != 0;
            return Err(insertion_error(
                if partially_inserted {
                    "Windows stopped text insertion."
                } else {
                    "Windows blocked text insertion. The target may be running as administrator. Your text is available to copy."
                },
                partially_inserted,
            ));
        }
        input_started = true;
    }
    Ok(())
}

fn insertion_error(message: &str, input_started: bool) -> String {
    if input_started {
        let message = message
            .strip_suffix(" Your text is available to copy.")
            .unwrap_or(message);
        format!("{message} Some text may already be inserted; check the target before copying the result.")
    } else {
        message.into()
    }
}

#[cfg(test)]
mod insertion_tests {
    use super::*;
    use std::cell::Cell;

    fn target() -> Context {
        Context {
            hwnd: 7,
            focused_runtime_id: vec![1, 2, 3],
            ..Default::default()
        }
    }

    fn replaceable_target() -> Context {
        Context {
            focus_anchor: FocusAnchor {
                process_id: 42,
                control_type: UIA_EditControlTypeId.0,
                automation_id: "synthetic-editor".into(),
                parent_runtime_id: vec![9, 8, 7],
                unique_in_parent: true,
                original_unavailable: false,
            },
            ..target()
        }
    }

    #[test]
    fn recreated_editor_requires_dead_original_and_unique_identity_under_same_parent() {
        let target = replaceable_target();
        let mut current = target.clone();
        current.focused_runtime_id = vec![4, 5, 6];
        current.focus_anchor.original_unavailable = true;
        assert!(validate_insertion_target(&target, &current).is_ok());

        // Sharing an AutomationId alone must not authorize another live field.
        current.focus_anchor.original_unavailable = false;
        assert!(validate_insertion_target(&target, &current).is_err());
    }

    #[test]
    fn changed_ambiguous_or_unavailable_replacement_evidence_never_authorizes_input() {
        let target = replaceable_target();
        for failure in 0..9 {
            let mut current = target.clone();
            current.focused_runtime_id = vec![4, 5, 6];
            current.focus_anchor.original_unavailable = true;
            match failure {
                0 => current.focus_anchor.process_id += 1,
                1 => current.focus_anchor.control_type = UIA_ButtonControlTypeId.0,
                2 => current.focus_anchor.automation_id.push_str("-other"),
                3 => current.focus_anchor.parent_runtime_id.push(0),
                4 => current.focus_anchor.unique_in_parent = false,
                5 => current.focus_anchor.automation_id.clear(),
                6 => current.focus_anchor.parent_runtime_id.clear(),
                7 => current.focused_runtime_id.clear(),
                _ => current.focus_anchor.original_unavailable = false,
            }
            assert!(
                validate_insertion_target(&target, &current).is_err(),
                "case {failure}"
            );
        }
        let mut original = target.clone();
        original.focus_anchor.unique_in_parent = false;
        let mut current = target.clone();
        current.focused_runtime_id = vec![4, 5, 6];
        current.focus_anchor.original_unavailable = true;
        assert!(validate_insertion_target(&original, &current).is_err());
    }

    #[test]
    fn verified_replacement_cannot_bypass_window_or_password_safety() {
        let target = replaceable_target();
        for failure in 0..3 {
            let mut current = target.clone();
            current.focused_runtime_id = vec![4, 5, 6];
            current.focus_anchor.original_unavailable = true;
            match failure {
                0 => current.hwnd += 1,
                1 => current.hwnd = 0,
                _ => current.password = true,
            }
            assert!(validate_insertion_target(&target, &current).is_err());
        }
    }

    #[test]
    fn only_explicit_element_removed_error_proves_replacement() {
        assert!(replacement_error_proves_removal(Some(
            UIA_E_ELEMENTNOTAVAILABLE
        )));
        for error in [None, Some(0x80004005), Some(0x800705b4), Some(0x800706ba)] {
            assert!(!replacement_error_proves_removal(error));
        }
    }

    #[test]
    fn native_focus_identity_is_never_serialized_into_model_context() {
        let target = replaceable_target();
        let json = serde_json::to_string(&target).unwrap();
        assert!(!json.contains("synthetic-editor"));
        assert!(!json.contains("focusAnchor"));
        assert!(!json.contains("focusedRuntimeId"));
        assert!(!json.contains("uniqueInParent"));
        let restored: Context = serde_json::from_str(&json).unwrap();
        assert!(restored.focused_runtime_id.is_empty());
        assert!(restored.focus_anchor.automation_id.is_empty());
    }

    #[test]
    fn transient_missing_or_intermediate_uia_focus_recovers_only_to_original_field() {
        for missing in [false, true] {
            let target = target();
            let probes = Cell::new(0);
            let pauses = Cell::new(0);
            let result = validate_target_with_retry(
                &target,
                &|| true,
                || {
                    probes.set(probes.get() + 1);
                    let mut current = target.clone();
                    if probes.get() < 3 {
                        if missing {
                            current.focused_runtime_id.clear();
                        } else {
                            current.focused_runtime_id.push(8);
                        }
                    }
                    current
                },
                |delay| {
                    assert_eq!(delay, FOCUS_PROBE_DELAY);
                    pauses.set(pauses.get() + 1);
                },
            );
            assert!(result.is_ok());
            assert_eq!(probes.get(), 3);
            assert_eq!(pauses.get(), 2);
        }
    }

    #[test]
    fn a_different_or_unavailable_field_never_becomes_the_new_target() {
        for missing in [false, true] {
            let target = target();
            let probes = Cell::new(0);
            let mut current = target.clone();
            if missing {
                current.focused_runtime_id.clear();
            } else {
                current.focused_runtime_id.push(8);
            }
            let error = validate_target_with_retry(
                &target,
                &|| true,
                || {
                    probes.set(probes.get() + 1);
                    current.clone()
                },
                |_| {},
            )
            .unwrap_err();
            assert!(error.contains(if missing {
                "could not be verified"
            } else {
                "another field"
            }));
            assert_eq!(probes.get(), FOCUS_PROBE_ATTEMPTS);
            assert_eq!(target.focused_runtime_id, vec![1, 2, 3]);
        }
    }

    #[test]
    fn focus_probe_never_retries_password_window_or_unavailable_foreground() {
        for failure in 0..3 {
            let target = target();
            let mut current = target.clone();
            match failure {
                0 => current.password = true,
                1 => current.hwnd += 1,
                _ => current.hwnd = 0,
            }
            let probes = Cell::new(0);
            let result = validate_target_with_retry(
                &target,
                &|| true,
                || {
                    probes.set(probes.get() + 1);
                    current.clone()
                },
                |_| panic!("unsafe target must not be retried"),
            );
            assert!(result.is_err());
            assert_eq!(probes.get(), 1);
        }
    }

    #[test]
    fn cancellation_during_focus_probe_or_pause_never_authorizes_input() {
        for cancel_in_sample in [false, true] {
            let target = target();
            let active = Cell::new(true);
            let probes = Cell::new(0);
            let result = validate_target_with_retry(
                &target,
                &|| active.get(),
                || {
                    probes.set(probes.get() + 1);
                    let mut current = target.clone();
                    if cancel_in_sample {
                        active.set(false);
                    } else {
                        current.focused_runtime_id.clear();
                    }
                    current
                },
                |_| active.set(false),
            );
            assert!(result.unwrap_err().contains("cancelled"));
            assert_eq!(probes.get(), 1);
        }
    }

    #[test]
    fn stable_focus_passes_without_delay_or_redundant_sample() {
        let target = target();
        let probes = Cell::new(0);
        validate_target_with_retry(
            &target,
            &|| true,
            || {
                probes.set(probes.get() + 1);
                target.clone()
            },
            |_| panic!("stable focus does not wait"),
        )
        .unwrap();
        assert_eq!(probes.get(), 1);
    }

    #[test]
    fn missing_original_field_cannot_authorize_a_new_or_unverifiable_field() {
        let mut target = target();
        target.focused_runtime_id.clear();
        for current_has_identity in [false, true] {
            let current = if current_has_identity {
                self::target()
            } else {
                target.clone()
            };
            let probes = Cell::new(0);
            let result = validate_target_with_retry(
                &target,
                &|| true,
                || {
                    probes.set(probes.get() + 1);
                    current.clone()
                },
                |_| panic!("missing original field must never adopt a later identity"),
            );
            assert!(result.unwrap_err().contains("original text field"));
            assert_eq!(probes.get(), 1);
        }
    }

    #[test]
    fn initial_capture_waits_for_an_identity_in_the_original_window_only() {
        let probes = Cell::new(0);
        let captured = capture_target_with_retry(
            || {
                probes.set(probes.get() + 1);
                let mut current = target();
                if probes.get() < 3 {
                    current.focused_runtime_id.clear();
                }
                current
            },
            |_| {},
        );
        assert_eq!(probes.get(), 3);
        assert_eq!(captured.hwnd, target().hwnd);
        assert_eq!(captured.focused_runtime_id, target().focused_runtime_id);
    }

    #[test]
    fn initial_capture_can_retry_a_cold_worker_without_authorizing_empty_identity() {
        let original = target();
        let no_reply = context_after_focus_response(None, original.hwnd, original.hwnd);
        assert_eq!(no_reply.hwnd, original.hwnd);
        assert!(no_reply.focused_runtime_id.is_empty());
        assert!(validate_insertion_target(&no_reply, &original).is_err());
        let probes = Cell::new(0);
        let captured = capture_target_with_retry(
            || {
                probes.set(probes.get() + 1);
                if probes.get() == 1 {
                    no_reply.clone()
                } else {
                    original.clone()
                }
            },
            |_| {},
        );
        assert_eq!(probes.get(), 2);
        assert!(validate_insertion_target(&original, &captured).is_ok());
    }

    #[test]
    fn cold_worker_metadata_never_rehabilitates_rejected_or_changed_windows() {
        let original = target();
        for current_window in [0, original.hwnd + 1] {
            assert_eq!(
                context_after_focus_response(None, original.hwnd, current_window).hwnd,
                0
            );
        }
        let probes = Cell::new(0);
        let captured = capture_target_with_retry(
            || {
                probes.set(probes.get() + 1);
                context_after_focus_response(Some(Context::default()), original.hwnd, original.hwnd)
            },
            |_| panic!("An actual rejected snapshot must not be retried as a valid window"),
        );
        assert_eq!(probes.get(), 1);
        assert_eq!(captured.hwnd, 0);
    }

    #[test]
    fn initial_capture_never_adopts_another_window_or_its_text() {
        let probes = Cell::new(0);
        let captured = capture_target_with_retry(
            || {
                probes.set(probes.get() + 1);
                let mut current = target();
                if probes.get() == 1 {
                    current.focused_runtime_id.clear();
                } else {
                    current.hwnd += 1;
                    current.selected = "private selection fixture".into();
                    current.nearby = "private context fixture".into();
                    current.window_title = "private title fixture".into();
                }
                current
            },
            |_| {},
        );
        assert_eq!(probes.get(), 2);
        assert_eq!(captured.hwnd, 0);
        assert!(captured.selected.is_empty());
        assert!(captured.nearby.is_empty());
        assert!(captured.window_title.is_empty());
    }

    #[test]
    fn initial_capture_has_bounded_missing_identity_attempts_and_stops_on_password() {
        for password in [false, true] {
            let probes = Cell::new(0);
            let captured = capture_target_with_retry(
                || {
                    probes.set(probes.get() + 1);
                    Context {
                        hwnd: 7,
                        password,
                        ..Default::default()
                    }
                },
                |_| {},
            );
            assert_eq!(
                probes.get(),
                if password { 1 } else { FOCUS_PROBE_ATTEMPTS }
            );
            assert!(captured.focused_runtime_id.is_empty());
            assert_eq!(captured.password, password);
        }
    }

    #[test]
    fn unicode_preserves_utf16_and_whitespace_without_an_appended_enter() {
        let text = "  Łódź 🐈\r\n\tgit status";
        let inputs = unicode_inputs(text);
        let mut units = Vec::new();
        for pair in inputs.chunks_exact(2) {
            unsafe {
                let down = pair[0].Anonymous.ki;
                let up = pair[1].Anonymous.ki;
                assert_eq!(down.wVk, VIRTUAL_KEY(0));
                assert_eq!(down.dwFlags, KEYEVENTF_UNICODE);
                assert_eq!(up.dwFlags, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
                assert_eq!(down.wScan, up.wScan);
                units.push(down.wScan);
            }
        }
        assert_eq!(
            String::from_utf16(&units).unwrap(),
            text.replace("\r\n", "\n")
        );
    }

    #[test]
    fn fallback_rechecks_current_password_field_before_any_input() {
        let target = target();
        let mut current = target.clone();
        current.password = true;
        let sent = Cell::new(0);
        let result = crate::clipboard::with_unicode_fallback(
            || Err(crate::clipboard::PasteError::PreservationFailed),
            || {
                type_unicode_batches(
                    "public fixture",
                    &target,
                    &|| true,
                    || current.clone(),
                    |batch| {
                        sent.set(sent.get() + 1);
                        batch.len() as u32
                    },
                )
            },
        );
        assert!(result.unwrap_err().contains("password"));
        assert_eq!(sent.get(), 0);
    }

    #[test]
    fn changed_window_or_field_between_batches_stops_the_remaining_input() {
        let target = target();
        for changed_window in [false, true] {
            let mut current = target.clone();
            if changed_window {
                current.hwnd += 1;
            } else {
                current.focused_runtime_id.push(4);
            }
            let sent = Cell::new(0);
            let result = type_unicode_batches(
                &"a".repeat(40),
                &target,
                &|| true,
                || {
                    if sent.get() == 0 {
                        target.clone()
                    } else {
                        current.clone()
                    }
                },
                |batch| {
                    sent.set(sent.get() + 1);
                    batch.len() as u32
                },
            );
            let error = result.unwrap_err();
            assert!(error.contains("Focus changed"));
            assert!(error.contains("may already be inserted"));
            assert_eq!(sent.get(), 1);
        }
    }

    #[test]
    fn unavailable_foreground_is_not_treated_as_a_matching_input_target() {
        let missing = Context::default();
        let sent = Cell::new(0);
        let result = type_unicode_batches(
            "public fixture",
            &missing,
            &|| true,
            || missing.clone(),
            |batch| {
                sent.set(sent.get() + 1);
                batch.len() as u32
            },
        );
        assert!(result.unwrap_err().contains("unavailable"));
        assert_eq!(sent.get(), 0);
    }

    #[test]
    fn cancelled_unicode_take_does_not_capture_or_send_another_batch() {
        let target = target();
        let active = Cell::new(true);
        let captured = Cell::new(0);
        let sent = Cell::new(0);
        let result = type_unicode_batches(
            &"a".repeat(40),
            &target,
            &|| active.get(),
            || {
                captured.set(captured.get() + 1);
                target.clone()
            },
            |batch| {
                sent.set(sent.get() + 1);
                active.set(false);
                batch.len() as u32
            },
        );
        assert!(result.unwrap_err().contains("cancelled"));
        assert_eq!(captured.get(), 1);
        assert_eq!(sent.get(), 1);
    }

    #[test]
    fn partial_unicode_dispatch_is_terminal_without_replaying_the_batch() {
        let target = target();
        for returned in [0, 1, 63] {
            let sent = Cell::new(0);
            let result = type_unicode_batches(
                &"a".repeat(40),
                &target,
                &|| true,
                || target.clone(),
                |_| {
                    sent.set(sent.get() + 1);
                    returned
                },
            );
            let error = result.unwrap_err();
            assert!(error.contains(if returned == 0 {
                "blocked"
            } else {
                "may already be inserted"
            }));
            assert_eq!(sent.get(), 1);
        }
    }

    #[test]
    fn later_zero_dispatch_reports_the_prior_prefix_without_replaying() {
        let target = target();
        let sent = Cell::new(0);
        let result = type_unicode_batches(
            &"a".repeat(70),
            &target,
            &|| true,
            || target.clone(),
            |batch| {
                sent.set(sent.get() + 1);
                if sent.get() == 1 {
                    batch.len() as u32
                } else {
                    0
                }
            },
        );
        assert!(result.unwrap_err().contains("may already be inserted"));
        assert_eq!(sent.get(), 2);
    }

    #[test]
    fn later_password_field_reports_prior_input_without_sending_more() {
        let target = target();
        let sent = Cell::new(0);
        let result = type_unicode_batches(
            &"a".repeat(70),
            &target,
            &|| true,
            || Context {
                password: sent.get() != 0,
                ..target.clone()
            },
            |batch| {
                sent.set(sent.get() + 1);
                batch.len() as u32
            },
        );
        let error = result.unwrap_err();
        assert!(error.contains("password"));
        assert!(error.contains("may already be inserted"));
        assert_eq!(sent.get(), 1);
    }
}

#[cfg(test)]
#[path = "native/focus_integration.rs"]
mod focus_integration;
