//! Recording-scoped, per-session Windows audio attenuation. COM stays on one
//! worker; stopping a recording only queues restoration, never delays inference.
#[cfg(any(windows, test))]
fn volume_factor(reduction_percent: u32) -> f32 {
    1.0 - reduction_percent.clamp(10, 90) as f32 / 100.0
}

#[cfg(any(windows, test))]
fn restore_volume(original: f32, applied: f32, current: f32, user_changed: bool) -> Option<f32> {
    (!user_changed && current.is_finite() && (current - applied).abs() < 0.0001).then_some(original)
}

// The audio worker uses take identities, rather than a global on/off flag: a
// late release from an earlier recording cannot restore the next take's audio.
struct RecordingScopes<T> {
    current: Option<(u64, T)>,
}
impl<T> RecordingScopes<T> {
    fn new() -> Self {
        Self { current: None }
    }
    fn begin(&mut self, id: u64, active: bool, build: impl FnOnce() -> Option<T>) {
        self.clear();
        if active {
            self.current = build().map(|value| (id, value));
        }
    }
    fn get_mut(&mut self, id: u64) -> Option<&mut T> {
        self.current
            .as_mut()
            .filter(|(current, _)| *current == id)
            .map(|(_, value)| value)
    }
    fn end(&mut self, id: u64) {
        if self
            .current
            .as_ref()
            .is_some_and(|(current, _)| *current == id)
        {
            self.clear();
        }
    }
    fn clear(&mut self) {
        drop(self.current.take());
    }
}

#[cfg(windows)]
mod platform {
    use super::{restore_volume, volume_factor, RecordingScopes};
    use std::{
        collections::HashSet,
        sync::{
            atomic::{AtomicBool, AtomicU64, Ordering},
            mpsc::{self, Sender},
            Arc, OnceLock,
        },
        time::Duration,
    };
    use windows::{
        core::{implement, Interface, BOOL, GUID, PCWSTR},
        Win32::{
            Foundation::S_OK,
            Media::Audio::*,
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
                COINIT_MULTITHREADED,
            },
        },
    };

    const EVENT_CONTEXT: GUID = GUID::from_u128(0x4eef72f0_76d2_4fb4_9985_59b6cdf74293);
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    static WORKER: OnceLock<Option<Sender<Command>>> = OnceLock::new();

    enum Command {
        Begin(u64, Arc<AtomicBool>, f32),
        Refresh(u64),
        End(u64),
        Shutdown(Sender<()>),
    }

    pub struct RecordingDucking {
        id: u64,
        active: Arc<AtomicBool>,
        sender: Sender<Command>,
    }

    impl RecordingDucking {
        pub fn start(reduction_percent: u32) -> Option<Self> {
            let sender = WORKER.get_or_init(|| {
                let (sender, receiver) = mpsc::channel();
                let notifications = sender.clone();
                std::thread::Builder::new().name("audio-ducking".into())
                    .spawn(move || {
                        // This thread owns every COM object, including cleanup.
                        if unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_err() {
                            eprintln!("Background audio adjustment is unavailable on this device.");
                            return;
                        }
                        struct Apartment;
                        impl Drop for Apartment {
                            fn drop(&mut self) { unsafe { CoUninitialize() }; }
                        }
                        let _apartment = Apartment;
                        let mut current = RecordingScopes::new();
                        while let Ok(command) = receiver.recv() {
                            match command {
                                Command::Begin(id, active, factor) => {
                                    let enabled = active.load(Ordering::Acquire);
                                    current.begin(id, enabled, || {
                                        let take = Take::new(id, active, notifications.clone(), factor).ok();
                                        if take.is_none() {
                                            eprintln!("Background audio adjustment is unavailable on this device.");
                                        }
                                        take
                                    });
                                }
                                Command::Refresh(id) => {
                                    if let Some(take) = current.get_mut(id) {
                                        take.notifications_pending.store(false, Ordering::Release);
                                        take.refresh();
                                    }
                                }
                                Command::End(id) => {
                                    current.end(id);
                                }
                                Command::Shutdown(acknowledge) => {
                                    current.clear();
                                    let _ = acknowledge.send(());
                                    break;
                                }
                            }
                        }
                    }).ok().map(|_| sender)
            }).as_ref()?.clone();
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let active = Arc::new(AtomicBool::new(true));
            sender
                .send(Command::Begin(
                    id,
                    active.clone(),
                    volume_factor(reduction_percent),
                ))
                .ok()?;
            Some(Self { id, active, sender })
        }

        pub fn finish(&self) {
            if self.active.swap(false, Ordering::AcqRel) {
                let _ = self.sender.send(Command::End(self.id));
            }
        }
    }

    impl Drop for RecordingDucking {
        fn drop(&mut self) {
            self.finish();
        }
    }

    pub fn shutdown() {
        if let Some(Some(sender)) = WORKER.get() {
            let (acknowledge, restored) = mpsc::channel();
            if sender.send(Command::Shutdown(acknowledge)).is_ok() {
                // Normal quit gives the worker a chance to restore volumes.
                // A broken audio driver must not keep the application alive.
                let _ = restored.recv_timeout(Duration::from_secs(2));
            }
        }
    }

    #[implement(IAudioSessionNotification)]
    struct NewSession {
        id: u64,
        sender: Sender<Command>,
        active: Arc<AtomicBool>,
        pending: Arc<AtomicBool>,
    }
    impl IAudioSessionNotification_Impl for NewSession_Impl {
        fn OnSessionCreated(
            &self,
            _: windows::core::Ref<'_, IAudioSessionControl>,
        ) -> windows::core::Result<()> {
            // Never send apartment-bound interfaces through the channel.
            if self.active.load(Ordering::Acquire) && !self.pending.swap(true, Ordering::AcqRel) {
                let _ = self.sender.send(Command::Refresh(self.id));
            }
            Ok(())
        }
    }

    #[implement(IAudioSessionEvents)]
    struct VolumeChanges {
        changed: Arc<AtomicBool>,
        applied: f32,
    }
    impl IAudioSessionEvents_Impl for VolumeChanges_Impl {
        fn OnSimpleVolumeChanged(
            &self,
            volume: f32,
            _: BOOL,
            context: *const GUID,
        ) -> windows::core::Result<()> {
            // Mute-only changes leave the scalar untouched. Never change mute.
            let ours = !context.is_null() && unsafe { *context == EVENT_CONTEXT };
            if !ours && (volume - self.applied).abs() >= 0.0001 {
                self.changed.store(true, Ordering::Release);
            }
            Ok(())
        }
        fn OnDisplayNameChanged(&self, _: &PCWSTR, _: *const GUID) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnIconPathChanged(&self, _: &PCWSTR, _: *const GUID) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnChannelVolumeChanged(
            &self,
            _: u32,
            _: *const f32,
            _: u32,
            _: *const GUID,
        ) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnGroupingParamChanged(
            &self,
            _: *const GUID,
            _: *const GUID,
        ) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnStateChanged(&self, _: AudioSessionState) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnSessionDisconnected(
            &self,
            _: AudioSessionDisconnectReason,
        ) -> windows::core::Result<()> {
            Ok(())
        }
    }

    struct Adjusted {
        control: IAudioSessionControl,
        volume: ISimpleAudioVolume,
        events: IAudioSessionEvents,
        original: f32,
        applied: f32,
        changed: Arc<AtomicBool>,
        armed: bool,
    }
    impl Adjusted {
        fn begin(control: IAudioSessionControl, active: &AtomicBool, factor: f32) -> Option<Self> {
            let volume = control.cast::<ISimpleAudioVolume>().ok()?;
            let original = unsafe { volume.GetMasterVolume() }.ok()?;
            if !original.is_finite() || original <= 0.0 {
                return None;
            }
            let applied = original * factor;
            let changed = Arc::new(AtomicBool::new(false));
            let events: IAudioSessionEvents = VolumeChanges {
                changed: changed.clone(),
                applied,
            }
            .into();
            // No volume changes unless we can observe user adjustments.
            unsafe { control.RegisterAudioSessionNotification(&events) }.ok()?;
            let mut adjusted = Self {
                control,
                volume,
                events,
                original,
                applied,
                changed,
                armed: false,
            };
            let same = unsafe { adjusted.volume.GetMasterVolume() }
                .is_ok_and(|current| (current - original).abs() < 0.0001);
            if !same || adjusted.changed.load(Ordering::Acquire) || !active.load(Ordering::Acquire)
            {
                return None;
            }
            if unsafe { adjusted.volume.SetMasterVolume(applied, &EVENT_CONTEXT) }.is_err() {
                // A failed write must never trigger a compensating write.
                return None;
            }
            adjusted.armed = true;
            Some(adjusted)
        }
    }
    impl Drop for Adjusted {
        fn drop(&mut self) {
            unsafe {
                if let Some(current) = self
                    .armed
                    .then(|| self.volume.GetMasterVolume().ok())
                    .flatten()
                {
                    if let Some(volume) = restore_volume(
                        self.original,
                        self.applied,
                        current,
                        self.changed.load(Ordering::Acquire),
                    ) {
                        let _ = self.volume.SetMasterVolume(volume, &EVENT_CONTEXT);
                    }
                }
                let _ = self
                    .control
                    .UnregisterAudioSessionNotification(&self.events);
            }
        }
    }

    struct Manager {
        manager: IAudioSessionManager2,
        notification: IAudioSessionNotification,
    }
    impl Drop for Manager {
        fn drop(&mut self) {
            let _ = unsafe {
                self.manager
                    .UnregisterSessionNotification(&self.notification)
            };
        }
    }

    struct Take {
        active: Arc<AtomicBool>,
        factor: f32,
        notifications_pending: Arc<AtomicBool>,
        managers: Vec<Manager>,
        seen: HashSet<String>,
        adjusted: Vec<Adjusted>,
    }

    impl Take {
        fn new(
            id: u64,
            active: Arc<AtomicBool>,
            sender: Sender<Command>,
            factor: f32,
        ) -> windows::core::Result<Self> {
            let devices: IMMDeviceEnumerator =
                unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
            let devices = unsafe { devices.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)? };
            let mut take = Self {
                active,
                factor,
                notifications_pending: Arc::new(AtomicBool::new(false)),
                managers: vec![],
                seen: HashSet::new(),
                adjusted: vec![],
            };
            for index in 0..unsafe { devices.GetCount()? }.min(64) {
                let Ok(device) = (unsafe { devices.Item(index) }) else {
                    continue;
                };
                let Ok(manager) =
                    (unsafe { device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) })
                else {
                    continue;
                };
                let notification: IAudioSessionNotification = NewSession {
                    id,
                    sender: sender.clone(),
                    active: take.active.clone(),
                    pending: take.notifications_pending.clone(),
                }
                .into();
                // A device can support existing sessions even when new-session
                // notifications fail. Its initial enumeration still works.
                let _ = unsafe { manager.RegisterSessionNotification(&notification) };
                take.managers.push(Manager {
                    manager,
                    notification,
                });
            }
            take.refresh();
            Ok(take)
        }

        fn refresh(&mut self) {
            for manager in &self.managers {
                let Ok(sessions) = (unsafe { manager.manager.GetSessionEnumerator() }) else {
                    continue;
                };
                let Ok(count) = (unsafe { sessions.GetCount() }) else {
                    continue;
                };
                for index in 0..count.min(512) {
                    if !self.active.load(Ordering::Acquire) {
                        return;
                    }
                    let Ok(control) = (unsafe { sessions.GetSession(index) }) else {
                        continue;
                    };
                    let Ok(detail) = control.cast::<IAudioSessionControl2>() else {
                        continue;
                    };
                    // Skip system sounds and this application's own session.
                    if unsafe { detail.IsSystemSoundsSession() } == S_OK
                        || !unsafe { detail.GetProcessId() }
                            .is_ok_and(|pid| pid != std::process::id())
                    {
                        continue;
                    }
                    let Ok(identifier) = (unsafe { detail.GetSessionInstanceIdentifier() }) else {
                        continue;
                    };
                    let key = unsafe { identifier.to_string() };
                    unsafe { CoTaskMemFree(Some(identifier.0.cast())) };
                    let Ok(key) = key else { continue };
                    if !self.seen.insert(key) {
                        continue;
                    }
                    if let Some(adjusted) = Adjusted::begin(control, &self.active, self.factor) {
                        self.adjusted.push(adjusted);
                    }
                }
            }
        }
    }

    #[cfg(test)]
    mod real_session_tests {
        use super::*;

        #[test]
        #[ignore = "Opt-in hardware integration test: uses only a new silent session owned by this test process"]
        fn real_windows_session_reduces_restores_and_preserves_manual_adjustment() {
            // Never call Take::new: it enumerates other applications. This test
            // creates a unique session and hands only that control to production
            // adjustment code. The audio client is not started and emits no sound.
            unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
                .ok()
                .unwrap();
            struct Apartment;
            impl Drop for Apartment {
                fn drop(&mut self) {
                    unsafe { CoUninitialize() };
                }
            }
            let _apartment = Apartment;
            let enumerator: IMMDeviceEnumerator =
                unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.unwrap();
            let device =
                unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) }.unwrap();
            let client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None) }.unwrap();
            let session_id = GUID::from_u128(uuid::Uuid::new_v4().as_u128());
            let format = unsafe { client.GetMixFormat() }.unwrap();
            let initialized = unsafe {
                client.Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    0,
                    1_000_000,
                    0,
                    format,
                    Some(&session_id),
                )
            };
            unsafe { CoTaskMemFree(Some(format.cast())) };
            initialized.unwrap();
            let manager: IAudioSessionManager2 =
                unsafe { device.Activate(CLSCTX_ALL, None) }.unwrap();
            let control = unsafe { manager.GetAudioSessionControl(Some(&session_id), 0) }.unwrap();
            let detail: IAudioSessionControl2 = control.cast().unwrap();
            assert_eq!(
                unsafe { detail.GetProcessId() }.unwrap(),
                std::process::id()
            );
            let volume: ISimpleAudioVolume = control.cast().unwrap();
            let active = AtomicBool::new(true);
            for reduction in [10, 60, 90] {
                unsafe { volume.SetMasterVolume(0.8, &EVENT_CONTEXT) }.unwrap();
                let adjusted =
                    Adjusted::begin(control.clone(), &active, volume_factor(reduction)).unwrap();
                let actual = unsafe { volume.GetMasterVolume() }.unwrap();
                let expected = 0.8 * volume_factor(reduction);
                assert!((actual - expected).abs() < 0.0001);
                drop(adjusted);
                let restored = unsafe { volume.GetMasterVolume() }.unwrap();
                assert!((restored - 0.8).abs() < 0.0001);
                println!("Owned silent Windows session: reduction={reduction}% scalar={actual:.3}, restored={restored:.3}");
            }
            let adjusted = Adjusted::begin(control, &active, volume_factor(60)).unwrap();
            let user_context = GUID::from_u128(uuid::Uuid::new_v4().as_u128());
            unsafe { volume.SetMasterVolume(0.44, &user_context) }.unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(1);
            while !adjusted.changed.load(Ordering::Acquire) && std::time::Instant::now() < deadline
            {
                std::thread::sleep(Duration::from_millis(10));
            }
            assert!(
                adjusted.changed.load(Ordering::Acquire),
                "Windows volume-change notification was not observed"
            );
            drop(adjusted);
            let preserved = unsafe { volume.GetMasterVolume() }.unwrap();
            assert!((preserved - 0.44).abs() < 0.0001);
            println!("Manual fixture adjustment preserved: scalar={preserved:.3}; no other app session was modified");
        }
    }
}

#[cfg(windows)]
pub use platform::{shutdown, RecordingDucking};

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    struct TrackedVolume(u64, Arc<Mutex<Vec<u64>>>);
    impl Drop for TrackedVolume {
        fn drop(&mut self) {
            self.1.lock().unwrap().push(self.0);
        }
    }

    #[test]
    fn late_release_or_session_notification_cannot_touch_a_new_recording() {
        let restored = Arc::new(Mutex::new(vec![]));
        let mut scopes = RecordingScopes::new();
        scopes.begin(1, true, || Some(TrackedVolume(1, restored.clone())));
        scopes.begin(2, true, || {
            // Old restoration completes before a new reduction is applied.
            assert_eq!(*restored.lock().unwrap(), vec![1]);
            Some(TrackedVolume(2, restored.clone()))
        });
        scopes.end(1);
        assert!(scopes.get_mut(1).is_none());
        assert!(scopes.get_mut(2).is_some());
        assert_eq!(*restored.lock().unwrap(), vec![1]);
        scopes.end(2);
        scopes.end(2);
        assert_eq!(*restored.lock().unwrap(), vec![1, 2]);
    }

    #[test]
    fn release_before_audio_worker_begins_never_changes_volume() {
        let mut scopes = RecordingScopes::<()>::new();
        scopes.begin(1, false, || {
            panic!("Cancelled take must not enumerate or change audio")
        });
        assert!(scopes.get_mut(1).is_none());
    }

    #[test]
    fn shutdown_and_unexpected_scope_drop_restore_once() {
        let restored = Arc::new(Mutex::new(vec![]));
        let mut scopes = RecordingScopes::new();
        scopes.begin(1, true, || Some(TrackedVolume(1, restored.clone())));
        scopes.clear();
        scopes.clear();
        scopes.begin(2, true, || Some(TrackedVolume(2, restored.clone())));
        drop(scopes);
        assert_eq!(*restored.lock().unwrap(), vec![1, 2]);
    }

    #[test]
    fn slight_reduction_restores_the_exact_prior_scalar() {
        let applied = 0.8 * volume_factor(60);
        assert!((applied - 0.32).abs() < 0.0001);
        assert_eq!(restore_volume(0.8, applied, applied, false), Some(0.8));
    }
    #[test]
    fn user_volume_changes_are_never_overwritten_even_if_changed_back() {
        assert_eq!(restore_volume(0.8, 0.6, 0.4, false), None);
        assert_eq!(restore_volume(0.8, 0.6, 0.6, true), None);
    }
    #[test]
    fn invalid_device_state_cannot_trigger_a_volume_write() {
        assert_eq!(restore_volume(0.8, 0.6, f32::NAN, false), None);
        assert_eq!(restore_volume(0.8, 0.6, f32::INFINITY, false), None);
    }
    #[test]
    fn old_settings_keep_ducking_disabled_by_default() {
        let settings: crate::config::Settings = serde_json::from_str("{}").unwrap();
        assert!(!settings.general.duck_background_audio);
        assert_eq!(settings.general.ducking_reduction_percent, 60);
        let settings: crate::config::Settings =
            serde_json::from_str(r#"{"general":{"duckBackgroundAudio":true}}"#).unwrap();
        assert!(settings.general.duck_background_audio);
        assert_eq!(settings.general.ducking_reduction_percent, 60);
    }

    #[test]
    fn reduction_strength_is_bounded_and_maps_to_remaining_volume() {
        for (reduction, expected) in [
            (0, 0.9),
            (10, 0.9),
            (25, 0.75),
            (60, 0.4),
            (90, 0.1),
            (100, 0.1),
        ] {
            assert!((volume_factor(reduction) - expected).abs() < 0.0001);
        }
    }

    #[test]
    fn settings_reject_out_of_range_strengths_even_when_feature_is_off() {
        let mut settings = crate::config::Settings::default();
        for invalid in [0, 9, 91, u32::MAX] {
            settings.general.ducking_reduction_percent = invalid;
            assert!(settings.validate().unwrap_err().contains("audio reduction"));
        }
        for valid in [10, 60, 90] {
            settings.general.ducking_reduction_percent = valid;
            settings.validate().unwrap();
        }
    }
}
