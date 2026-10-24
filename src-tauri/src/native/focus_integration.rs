//! Opt-in interactive test. Only creates/focuses/closes its own synthetic UI.
//! Never sends keystrokes, accesses the clipboard, or reads another app's text.
use super::*;
use windows::core::w;

const WAKE: u32 = WM_APP + 91;

enum Command {
    Focus(usize, SyncSender<bool>),
    Close,
}

struct Fixture {
    hwnd: isize,
    thread_id: u32,
    commands: mpsc::Sender<Command>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Fixture {
    fn open() -> Self {
        let (ready, started) = mpsc::sync_channel(1);
        let (commands, incoming) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            let run = || -> Result<(), String> {
                unsafe {
                    let hwnd = CreateWindowExW(
                        WINDOW_EX_STYLE::default(),
                        w!("STATIC"),
                        w!("CridVoice owned focus test"),
                        WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                        80,
                        80,
                        480,
                        260,
                        None,
                        None,
                        None,
                        None,
                    )
                    .map_err(|_| "Could not create the owned focus fixture.")?;
                    struct OwnedWindow(HWND);
                    impl Drop for OwnedWindow {
                        fn drop(&mut self) {
                            let _ = unsafe { DestroyWindow(self.0) };
                        }
                    }
                    let _window = OwnedWindow(hwnd);
                    let mut controls = Vec::new();
                    for index in 0..4 {
                        let password = if index == 2 { ES_PASSWORD as u32 } else { 0 };
                        let class = if index == 3 { w!("BUTTON") } else { w!("EDIT") };
                        let control = CreateWindowExW(
                            WINDOW_EX_STYLE::default(),
                            class,
                            w!(""),
                            WS_CHILD | WS_VISIBLE | WS_TABSTOP | WINDOW_STYLE(password),
                            20,
                            20 + index * 42,
                            400,
                            30,
                            Some(hwnd),
                            Some(HMENU((1001 + index) as *mut _)),
                            None,
                            None,
                        )
                        .map_err(|_| "Could not create a synthetic input control.")?;
                        controls.push(control);
                    }
                    if ready
                        .send(Ok((hwnd.0 as isize, GetCurrentThreadId())))
                        .is_err()
                    {
                        return Ok(());
                    }
                    let mut message = MSG::default();
                    while GetMessageW(&mut message, None, 0, 0).0 > 0 {
                        if message.message == WAKE {
                            while let Ok(command) = incoming.try_recv() {
                                match command {
                                    Command::Focus(index, acknowledged) => {
                                        let visible_before_show = IsWindowVisible(hwnd).as_bool();
                                        // A hidden process launcher can supply STARTUPINFO
                                        // that overrides the first ShowWindow command.
                                        // Show only our fixture, then verify visibility.
                                        let _ = ShowWindow(hwnd, SW_SHOW);
                                        if !IsWindowVisible(hwnd).as_bool() {
                                            let _ = ShowWindow(hwnd, SW_SHOW);
                                        }
                                        let _ = SetActiveWindow(hwnd);
                                        let foreground_request_ok =
                                            SetForegroundWindow(hwnd).as_bool();
                                        let _ = SetFocus(Some(controls[index]));
                                        let own_foreground = GetForegroundWindow() == hwnd;
                                        let own_focus = GetFocus() == controls[index];
                                        let visible = IsWindowVisible(hwnd).as_bool();
                                        let enabled = IsWindowEnabled(hwnd).as_bool();
                                        let child_visible =
                                            IsWindowVisible(controls[index]).as_bool();
                                        let child_enabled =
                                            IsWindowEnabled(controls[index]).as_bool();
                                        eprintln!(
                                            "Owned focus fixture: control={index} visible_before_show={visible_before_show} visible={visible} enabled={enabled} child_visible={child_visible} child_enabled={child_enabled} own_active={} foreground_request_ok={foreground_request_ok} own_foreground={own_foreground} own_focus={own_focus}",
                                            GetActiveWindow() == hwnd,
                                        );
                                        let _ = acknowledged.send(
                                            own_foreground
                                                && own_focus
                                                && visible
                                                && enabled
                                                && child_visible
                                                && child_enabled,
                                        );
                                    }
                                    Command::Close => return Ok(()),
                                }
                            }
                        } else {
                            let _ = TranslateMessage(&message);
                            DispatchMessageW(&message);
                        }
                    }
                }
                Ok(())
            };
            if let Err(error) = run() {
                let _ = ready.send(Err(error));
            }
        });
        let (hwnd, thread_id) = started
            .recv_timeout(Duration::from_secs(5))
            .expect("Owned fixture startup timed out")
            .expect("Owned fixture startup failed");
        Self {
            hwnd,
            thread_id,
            commands,
            thread: Some(thread),
        }
    }

    fn focus(&self, index: usize) {
        let (acknowledged, result) = mpsc::sync_channel(1);
        self.commands
            .send(Command::Focus(index, acknowledged))
            .unwrap();
        unsafe { PostThreadMessageW(self.thread_id, WAKE, WPARAM(0), LPARAM(0)) }.unwrap();
        assert!(
            result.recv_timeout(Duration::from_secs(2)).unwrap(),
            "Windows did not activate the owned fixture; run with an idle interactive desktop"
        );
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.commands.send(Command::Close);
        let _ = unsafe { PostThreadMessageW(self.thread_id, WAKE, WPARAM(0), LPARAM(0)) };
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn capture_owned_field(hwnd: isize) -> Context {
    for _ in 0..10 {
        let captured = context(false);
        if captured.hwnd == hwnd && !captured.focused_runtime_id.is_empty() {
            return captured;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("UI Automation did not expose the owned synthetic field");
}

#[test]
#[ignore = "Requires an idle Windows desktop and CRIDVOICE_RUN_FOCUS_TEST=1"]
fn owned_window_stable_focus_and_real_field_password_button_guards() {
    assert_eq!(
        std::env::var("CRIDVOICE_RUN_FOCUS_TEST").as_deref(),
        Ok("1"),
        "Set CRIDVOICE_RUN_FOCUS_TEST=1 to authorize this owned-window interactive test"
    );
    let _ = focus_worker();
    let fixture = Fixture::open();
    fixture.focus(0);
    let original = capture_owned_field(fixture.hwnd);
    assert!(!original.password);
    for _ in 0..8 {
        let current = insertion_context(&original);
        assert_eq!(current.hwnd, fixture.hwnd);
        validate_insertion_target(&original, &current).expect("Stable owned field must match");
    }

    fixture.focus(1);
    let other = insertion_context(&original);
    assert_eq!(other.hwnd, fixture.hwnd);
    assert_ne!(other.focused_runtime_id, original.focused_runtime_id);
    assert!(
        !other.focus_anchor.original_unavailable,
        "Original control is still live"
    );
    assert!(validate_current_insertion_target(&original, &|| true)
        .unwrap_err()
        .contains("another field"));

    fixture.focus(3);
    let button = insertion_context(&original);
    assert_eq!(button.hwnd, fixture.hwnd);
    assert!(
        button.focused_runtime_id.is_empty(),
        "A button must not become a text field"
    );
    assert!(validate_insertion_target(&original, &button).is_err());

    fixture.focus(2);
    assert!(validate_current_insertion_target(&original, &|| true)
        .unwrap_err()
        .contains("password"));
    // Fixture::drop closes its own window on success and during unwinding.
    // Windows chooses the next foreground window; this test never restores or
    // otherwise activates any pre-existing application.
}
