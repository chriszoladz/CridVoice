//! A keyboard-capture lease owns its key releases independently of hotkeys.
use serde::Serialize;
use std::time::{Duration, Instant};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Event {
    pub id: String,
    pub phase: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shortcut: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
struct Lease {
    id: String,
    deadline: Instant,
    arming: bool,
    complete: bool,
    chord: [bool; 256],
}
pub(super) struct Capture {
    lease: Option<Lease>,
    down: [bool; 256],
    swallowed: [bool; 256],
    forwarded: [bool; 256],
    epoch: u64,
}
#[derive(Default)]
pub(super) struct Decision {
    pub handled: bool,
    pub swallow: bool,
    pub event: Option<Event>,
}
impl Capture {
    pub const fn new() -> Self {
        Self {
            lease: None,
            down: [false; 256],
            swallowed: [false; 256],
            forwarded: [false; 256],
            epoch: 0,
        }
    }
    pub fn epoch(&self) -> u64 {
        self.epoch
    }
    pub fn active(&self) -> bool {
        self.lease.is_some()
    }
    pub fn id(&self) -> Option<&str> {
        self.lease.as_ref().map(|lease| lease.id.as_str())
    }
    pub fn blocked(&self) -> bool {
        self.active() || self.down.iter().any(|v| *v) || self.swallowed.iter().any(|v| *v)
    }
    pub fn action_current(&self, epoch: u64) -> bool {
        epoch == self.epoch && !self.blocked()
    }
    pub fn begin(
        &mut self,
        id: String,
        now: Instant,
        held: [bool; 256],
        inherited: [bool; 256],
    ) -> Result<Event, String> {
        if self.active() {
            return Err("Finish the current shortcut capture first.".into());
        }
        for key in 0..256 {
            // Never take ownership of an up whose down already reached Windows.
            self.forwarded[key] |= held[key] && !self.swallowed[key] && !inherited[key];
            self.swallowed[key] |= inherited[key];
            self.down[key] |= held[key] || inherited[key];
        }
        self.epoch = self.epoch.wrapping_add(1);
        self.lease = Some(Lease {
            id: id.clone(),
            deadline: now + Duration::from_secs(30),
            arming: self.down.iter().any(|v| *v),
            complete: false,
            chord: [false; 256],
        });
        Ok(Event {
            id,
            phase: "listening",
            shortcut: None,
            error: None,
        })
    }
    pub fn end(&mut self, id: &str, error: Option<&str>) -> Option<Event> {
        if self.lease.as_ref()?.id != id {
            return None;
        }
        let lease = self.lease.take()?;
        self.epoch = self.epoch.wrapping_add(1);
        Some(Event {
            id: lease.id,
            phase: "cancelled",
            shortcut: None,
            error: error.map(str::to_owned),
        })
    }
    pub fn cancel(&mut self, error: &str) -> Option<Event> {
        let id = self.lease.as_ref()?.id.clone();
        self.end(&id, Some(error))
    }
    pub fn expire(&mut self, now: Instant) -> Option<Event> {
        let lease = self.lease.as_ref()?;
        if lease.complete || now < lease.deadline {
            return None;
        }
        self.cancel("Shortcut capture timed out. Try again.")
    }
    pub fn update(&mut self, key: u16, pressed: bool, injected: bool) -> Decision {
        if !self.blocked() || key >= 256 {
            return Decision::default();
        }
        let mut result = Decision {
            handled: true,
            ..Default::default()
        };
        // Synthetic input cannot become a captured binding or release proof.
        if injected {
            return result;
        }
        if key == 0x1b && pressed && self.active() {
            result.event = self.cancel("Shortcut capture cancelled.");
            return result; // Escape must still reach the dialog.
        }
        let index = key as usize;
        let repeated = self.down[index];
        let listening = self.lease.as_ref().is_some_and(|lease| !lease.complete);
        if pressed {
            self.down[index] = true;
            // Once complete, ordinary navigation reaches the dialog. Windows
            // downs still need suppression so editing never opens Start.
            if !self.forwarded[index]
                && (listening || self.swallowed[index] || matches!(key, 0x5b | 0x5c))
            {
                self.swallowed[index] = true;
                result.swallow = true;
            } else {
                self.forwarded[index] = true;
            }
        } else {
            self.down[index] = false;
            result.swallow = self.swallowed[index];
            self.swallowed[index] = false;
            self.forwarded[index] = false;
        }
        let released = !self.down.iter().any(|v| *v);
        if let Some(lease) = &mut self.lease {
            if lease.arming {
                if released {
                    lease.arming = false;
                }
            } else if !lease.complete {
                if pressed && !repeated {
                    lease.chord[index] = true;
                    result.event = Some(Event {
                        id: lease.id.clone(),
                        phase: "candidate",
                        shortcut: chord(&lease.chord).ok(),
                        error: None,
                    });
                } else if !pressed && released && lease.chord.iter().any(|v| *v) {
                    lease.complete = true;
                    let value = chord(&lease.chord)
                        .and_then(|value| crate::core::parse_shortcut(&value).map(|_| value));
                    result.event = Some(match value {
                        Ok(value) => Event {
                            id: lease.id.clone(),
                            phase: "complete",
                            shortcut: Some(value),
                            error: None,
                        },
                        Err(error) => Event {
                            id: lease.id.clone(),
                            phase: "error",
                            shortcut: None,
                            error: Some(error),
                        },
                    });
                }
            }
        }
        result
    }
}
fn chord(keys: &[bool; 256]) -> Result<String, String> {
    let mut parts = Vec::new();
    for (held, label) in [
        (keys[0xa2] || keys[0xa3], "Ctrl"),
        (keys[0xa4] || keys[0xa5], "Alt"),
        (keys[0xa0] || keys[0xa1], "Shift"),
        (keys[0x5b] || keys[0x5c], "Super"),
    ] {
        if held {
            parts.push(label.to_string());
        }
    }
    let mut ordinary = None;
    for (key, held) in keys.iter().enumerate() {
        if !held || matches!(key, 0xa0..=0xa5 | 0x5b | 0x5c) {
            continue;
        }
        let label = match key {
            0x30..=0x39 | 0x41..=0x5a => char::from_u32(key as u32).unwrap().to_string(),
            0x20 => "Space".into(),
            0x09 => "Tab".into(),
            0x70..=0x87 => format!("F{}", key - 0x70 + 1),
            _ => return Err("Use letters, numbers, Space, Tab, or F1–F24 with modifiers.".into()),
        };
        if ordinary.replace(label).is_some() {
            return Err("Only one ordinary key is supported in a shortcut.".into());
        }
    }
    parts.extend(ordinary);
    Ok(parts.join("+"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn capture() -> Capture {
        let mut capture = Capture::new();
        capture
            .begin("first".into(), Instant::now(), [false; 256], [false; 256])
            .unwrap();
        capture
    }
    #[test]
    fn both_ctrl_windows_orders_complete_after_full_release_and_keep_lease() {
        for keys in [[0xa2, 0x5b], [0x5b, 0xa3]] {
            for reverse in [false, true] {
                let mut capture = capture();
                for key in keys {
                    assert!(capture.update(key, true, false).swallow);
                }
                let releases = if reverse { [keys[1], keys[0]] } else { keys };
                assert!(capture.update(releases[0], false, false).event.is_none());
                let event = capture.update(releases[1], false, false).event.unwrap();
                assert_eq!(event.phase, "complete");
                assert_eq!(event.shortcut.as_deref(), Some("Ctrl+Super"));
                assert!(capture.active());
                assert!(!capture.action_current(capture.epoch()));
                assert!(capture.update(0x5b, true, false).swallow);
                assert!(capture.update(0x5b, false, false).swallow);
                assert!(!capture.update(9, true, false).swallow);
            }
        }
    }
    #[test]
    fn activation_key_releases_before_capture_and_forwarded_windows_up_passes() {
        let mut capture = Capture::new();
        let mut held = [false; 256];
        held[0x0d] = true;
        held[0x5b] = true;
        capture
            .begin("first".into(), Instant::now(), held, [false; 256])
            .unwrap();
        assert!(!capture.update(0x5b, true, false).swallow);
        assert!(!capture.update(0x5b, false, false).swallow);
        assert!(capture.update(0x0d, false, false).event.is_none());
        capture.update(0xa2, true, false);
        capture.update(0x41, true, false);
        capture.update(0x41, false, false);
        let event = capture.update(0xa2, false, false).event.unwrap();
        assert_eq!(event.shortcut.as_deref(), Some("Ctrl+A"));
    }
    #[test]
    fn cancel_retains_owned_releases_and_never_adopts_capture_downs() {
        let mut capture = capture();
        let old_epoch = capture.epoch();
        capture.update(0xa2, true, false);
        capture.update(0x5b, true, false);
        capture.end("first", None).unwrap();
        assert!(!capture.action_current(old_epoch));
        assert!(capture.update(0x5b, true, false).swallow);
        assert!(capture.update(0x5b, false, false).swallow);
        assert!(capture.update(0xa2, false, false).swallow);
        assert!(!capture.blocked());
        assert!(!capture.update(0xa2, true, false).handled);
    }
    #[test]
    fn stale_end_does_not_release_a_new_lease() {
        let mut capture = capture();
        capture.end("first", None);
        capture
            .begin("second".into(), Instant::now(), [false; 256], [false; 256])
            .unwrap();
        let epoch = capture.epoch();
        assert!(capture.end("first", None).is_none());
        assert!(capture.active());
        assert_eq!(epoch, capture.epoch());
    }
    #[test]
    fn escape_injection_and_timeout_cannot_dispatch_or_complete_a_chord() {
        let mut capture = capture();
        assert!(capture.update(0x5b, true, true).event.is_none());
        capture.update(0xa2, true, false);
        assert!(capture.update(0xa2, false, true).event.is_none());
        let escape = capture.update(0x1b, true, false);
        assert!(!escape.swallow);
        assert_eq!(escape.event.unwrap().phase, "cancelled");
        assert!(capture.update(0xa2, false, false).swallow);
        let now = Instant::now();
        capture
            .begin("next".into(), now, [false; 256], [false; 256])
            .unwrap();
        assert!(capture.expire(now + Duration::from_secs(29)).is_none());
        assert_eq!(
            capture.expire(now + Duration::from_secs(30)).unwrap().phase,
            "cancelled"
        );
    }
    #[test]
    fn unsupported_multiple_keys_fail_but_completed_lease_remains_safe() {
        for ordinary in [[0x41, 0x42], [0x25, 0x25]] {
            let mut capture = capture();
            capture.update(0xa2, true, false);
            for key in ordinary {
                capture.update(key, true, false);
            }
            for key in ordinary {
                capture.update(key, false, false);
            }
            let event = capture.update(0xa2, false, false).event.unwrap();
            assert_eq!(event.phase, "error");
            assert!(capture.active());
        }
    }
    #[test]
    fn complete_does_not_expire_or_capture_a_repeated_binding() {
        let mut capture = capture();
        capture.update(0xa2, true, false);
        capture.update(0x5b, true, false);
        capture.update(0xa2, false, false);
        capture.update(0x5b, false, false);
        assert!(capture
            .expire(Instant::now() + Duration::from_secs(90))
            .is_none());
        assert!(capture.update(0xa2, true, false).event.is_none());
        assert!(capture.update(0x5b, true, false).swallow);
        assert!(capture.update(0x5b, false, false).swallow);
        assert!(capture.update(0xa2, false, false).event.is_none());
    }
    #[test]
    fn queued_hotkey_before_capture_cannot_revive_after_the_lease_ends() {
        let mut capture = Capture::new();
        let queued_epoch = capture.epoch();
        assert!(capture.action_current(queued_epoch));
        capture
            .begin("first".into(), Instant::now(), [false; 256], [false; 256])
            .unwrap();
        assert!(!capture.action_current(queued_epoch));
        capture.end("first", None).unwrap();
        assert!(!capture.action_current(queued_epoch));
        assert!(capture.action_current(capture.epoch()));
    }
    #[test]
    fn inherited_windows_ownership_and_cancelled_keys_drain_before_retry() {
        let mut capture = Capture::new();
        let mut owned = [false; 256];
        owned[0x5b] = true;
        capture
            .begin("first".into(), Instant::now(), [false; 256], owned)
            .unwrap();
        capture.cancel("Lost focus.");
        capture
            .begin("second".into(), Instant::now(), [false; 256], [false; 256])
            .unwrap();
        assert!(capture.update(0x5b, false, false).swallow);
        capture.update(0xa3, true, false);
        capture.update(0x87, true, false);
        capture.update(0x87, false, false);
        let event = capture.update(0xa3, false, false).event.unwrap();
        assert_eq!(event.id, "second");
        assert_eq!(event.shortcut.as_deref(), Some("Ctrl+F24"));
    }
}
