use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicU32, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
pub fn devices() -> Result<Vec<String>, String> {
    cpal::default_host()
        .input_devices()
        .map_err(|e| e.to_string())?
        .map(|d| d.name().map_err(|e| e.to_string()))
        .collect()
}
pub struct Recorder {
    ducking: Option<crate::ducking::RecordingDucking>,
    failure: Arc<Mutex<Option<String>>>,
    samples: Arc<Mutex<Vec<f32>>>,
    rate: u32,
    pub level: Arc<AtomicU32>,
    stop: mpsc::Sender<()>,
    join: Option<std::thread::JoinHandle<()>>,
    started: Instant,
}
pub struct AudioSnapshot {
    samples: Vec<f32>,
    rate: u32,
    start_sample: usize,
}
fn receive_samples<T: Copy>(
    data: &[T],
    channels: usize,
    limit: usize,
    samples: &Mutex<Vec<f32>>,
    level: &AtomicU32,
    normalize: impl Fn(T) -> f32,
) {
    let mut buf = samples.lock().unwrap();
    let mut square = 0.;
    let mut count = 0;
    for frame in data.chunks(channels) {
        let value = frame.iter().copied().map(&normalize).sum::<f32>() / channels as f32;
        square += value * value;
        count += 1;
        if buf.len() < limit {
            buf.push(value)
        }
    }
    let rms = if count > 0 {
        (square / count as f32).sqrt()
    } else {
        0.
    };
    level.store((rms.min(1.) * 10000.) as u32, Ordering::Relaxed);
}
impl Recorder {
    pub fn start(name: &str, max_seconds: u32) -> Result<Self, String> {
        let name = name.to_owned();
        let samples = Arc::new(Mutex::new(Vec::new()));
        let level = Arc::new(AtomicU32::new(0));
        let ss = samples.clone();
        let ll = level.clone();
        let failure = Arc::new(Mutex::new(None));
        let ff = failure.clone();
        let (stop, rx) = mpsc::channel();
        let (init, ready) = mpsc::channel();
        let join = std::thread::spawn(move || {
            let result = (|| -> Result<(cpal::Stream, u32), String> {
                let host = cpal::default_host();
                let device=if name.is_empty(){host.default_input_device()}else{host.input_devices().map_err(|e|e.to_string())?.find(|d|d.name().ok().as_deref()==Some(&name))}.ok_or("No microphone found. Connect a microphone and check Windows microphone permissions.")?;
                let supported = device.default_input_config().map_err(|e| e.to_string())?;
                let format = supported.sample_format();
                let config: cpal::StreamConfig = supported.into();
                let rate = config.sample_rate.0;
                let channels = config.channels as usize;
                let limit = rate as usize * max_seconds as usize;
                let err = move |e: cpal::StreamError| {
                    *ff.lock().unwrap() = Some(e.to_string());
                };
                let stream = match format {
                    cpal::SampleFormat::F32 => device.build_input_stream(
                        &config,
                        move |d: &[f32], _| {
                            receive_samples(d, channels, limit, &ss, &ll, |sample| sample)
                        },
                        err,
                        None,
                    ),
                    cpal::SampleFormat::I16 => device.build_input_stream(
                        &config,
                        move |d: &[i16], _| {
                            receive_samples(d, channels, limit, &ss, &ll, |sample| {
                                sample as f32 / 32768.
                            })
                        },
                        err,
                        None,
                    ),
                    cpal::SampleFormat::U16 => device.build_input_stream(
                        &config,
                        move |d: &[u16], _| {
                            receive_samples(d, channels, limit, &ss, &ll, |sample| {
                                (sample as f32 - 32768.) / 32768.
                            })
                        },
                        err,
                        None,
                    ),
                    _ => return Err(
                        "Microphone format is unsupported. Choose another microphone in Settings."
                            .into(),
                    ),
                }
                .map_err(|e| e.to_string())?;
                stream.play().map_err(|e| e.to_string())?;
                Ok((stream, rate))
            })();
            match result {
                Ok((stream, rate)) => {
                    let _ = init.send(Ok(rate));
                    let _ = rx.recv();
                    drop(stream)
                }
                Err(e) => {
                    let _ = init.send(Err(e));
                }
            }
        });
        let rate = ready
            .recv_timeout(std::time::Duration::from_secs(10))
            .map_err(|_| "Microphone did not initialize.".to_string())??;
        Ok(Self {
            ducking: None,
            failure,
            samples,
            rate,
            level,
            stop,
            join: Some(join),
            started: Instant::now(),
        })
    }
    pub fn elapsed(&self) -> f64 {
        self.started.elapsed().as_secs_f64()
    }
    pub fn failure(&self) -> Option<String> {
        self.failure.lock().unwrap().clone()
    }
    pub fn request_stop(&self) {
        if let Some(ducking) = &self.ducking {
            ducking.finish();
        }
        let _ = self.stop.send(());
    }
    pub fn lower_background_audio(&mut self, reduction_percent: u32) {
        self.ducking = crate::ducking::RecordingDucking::start(reduction_percent);
    }
    pub fn stop_capture(&mut self) -> f64 {
        let duration = self.elapsed();
        self.request_stop();
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
        duration
    }
    pub fn capture(&self) -> AudioSnapshot {
        AudioSnapshot {
            samples: self.samples.lock().unwrap().clone(),
            rate: self.rate,
            start_sample: 0,
        }
    }
    pub fn capture_tail(&self, max_duration: Duration) -> AudioSnapshot {
        let max_samples = usize::try_from(
            max_duration
                .as_nanos()
                .saturating_mul(u128::from(self.rate))
                / 1_000_000_000,
        )
        .unwrap_or(usize::MAX);
        let samples = self.samples.lock().unwrap();
        let start_sample = samples.len().saturating_sub(max_samples);
        AudioSnapshot {
            samples: samples[start_sample..].to_vec(),
            rate: self.rate,
            start_sample,
        }
    }
}
impl AudioSnapshot {
    pub fn offset_seconds(&self) -> f64 {
        self.start_sample as f64 / f64::from(self.rate)
    }
    pub fn duration_seconds(&self) -> f64 {
        self.samples.len() as f64 / f64::from(self.rate)
    }
    pub fn write(self, path: &Path) -> Result<(), String> {
        let samples = self.samples;
        let count = (samples.len() as u64 * 16000 / self.rate as u64) as usize;
        let mut out = hound::WavWriter::create(
            path,
            hound::WavSpec {
                channels: 1,
                sample_rate: 16000,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            },
        )
        .map_err(|e| e.to_string())?;
        // A windowed sinc resampler avoids aliasing at 44.1/48 kHz microphone rates.
        let scale = self.rate as f64 / 16000.;
        let cutoff = (16000_f64 / self.rate as f64).min(1.) * 0.94;
        for i in 0..count {
            let pos = i as f64 * scale;
            let center = pos.floor() as isize;
            let mut sum = 0.;
            let mut norm = 0.;
            for j in -12..=12 {
                let at = center + j;
                if at < 0 || at as usize >= samples.len() {
                    continue;
                }
                let delta = pos - at as f64;
                let x = std::f64::consts::PI * delta * cutoff;
                let sinc = if x.abs() < 1e-10 { 1. } else { x.sin() / x };
                let window = 0.5 + 0.5 * (std::f64::consts::PI * delta / 13.).cos();
                let weight = sinc * window * cutoff;
                sum += samples[at as usize] as f64 * weight;
                norm += weight;
            }
            let f = if norm.abs() > 1e-10 { sum / norm } else { 0. };
            out.write_sample((f.clamp(-1., 1.) * 32767.) as i16)
                .map_err(|e| e.to_string())?;
        }
        out.finalize().map_err(|e| e.to_string())
    }
}
impl Drop for Recorder {
    fn drop(&mut self) {
        self.stop_capture();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_input_matches_normalized(
        expected: &[f32],
        receive: impl Fn(&Mutex<Vec<f32>>, &AtomicU32, usize, usize),
    ) {
        for channels in [1, 2, 3] {
            for limit in [0, 1, expected.len()] {
                let reference = Mutex::new(Vec::new());
                let reference_level = AtomicU32::new(0);
                receive_samples(
                    expected,
                    channels,
                    limit,
                    &reference,
                    &reference_level,
                    |sample| sample,
                );
                let actual = Mutex::new(Vec::new());
                let actual_level = AtomicU32::new(0);
                receive(&actual, &actual_level, channels, limit);
                assert_eq!(*actual.lock().unwrap(), *reference.lock().unwrap());
                assert_eq!(
                    actual_level.load(Ordering::Relaxed),
                    reference_level.load(Ordering::Relaxed)
                );
            }
        }
    }

    #[test]
    fn integer_input_normalizes_without_intermediate_buffers() {
        let signed = [i16::MIN, -12345, -1, 0, 1, 12345, i16::MAX];
        let normalized = signed.map(|sample| sample as f32 / 32768.);
        assert_input_matches_normalized(&normalized, |samples, level, channels, limit| {
            receive_samples(&signed, channels, limit, samples, level, |sample| {
                sample as f32 / 32768.
            });
        });

        let unsigned = [0u16, 12345, 32767, 32768, 32769, 54321, u16::MAX];
        let normalized = unsigned.map(|sample| (sample as f32 - 32768.) / 32768.);
        assert_input_matches_normalized(&normalized, |samples, level, channels, limit| {
            receive_samples(&unsigned, channels, limit, samples, level, |sample| {
                (sample as f32 - 32768.) / 32768.
            });
        });
    }

    #[test]
    fn input_preserves_channel_average_recording_limit_and_level_after_limit() {
        let samples = Mutex::new(Vec::new());
        let level = AtomicU32::new(0);
        receive_samples(&[0.5f32, -0.5, 0.75, 0.25], 2, 1, &samples, &level, |v| v);
        assert_eq!(*samples.lock().unwrap(), vec![0.]);
        assert_eq!(level.load(Ordering::Relaxed), 3535);
        receive_samples(&[1f32, 1.], 2, 1, &samples, &level, |v| v);
        assert_eq!(*samples.lock().unwrap(), vec![0.]);
        assert_eq!(level.load(Ordering::Relaxed), 10000);
        receive_samples::<f32>(&[], 2, 1, &samples, &level, |v| v);
        assert_eq!(*samples.lock().unwrap(), vec![0.]);
        assert_eq!(level.load(Ordering::Relaxed), 0);
    }

    fn fixture(rate: u32) -> Recorder {
        let pattern = [
            0., 0.25, 0.5, 0.75, 1., 0.75, 0.5, 0.25, 0., -0.25, -0.5, -0.75, -1., -0.75, -0.5,
            -0.25,
        ];
        let (stop, _) = mpsc::channel();
        Recorder {
            ducking: None,
            samples: Arc::new(Mutex::new(pattern.repeat(2))),
            rate,
            failure: Arc::new(Mutex::new(None)),
            level: Arc::new(AtomicU32::new(0)),
            stop,
            join: None,
            started: Instant::now(),
        }
    }

    #[test]
    fn tail_capture_clips_to_six_seconds_at_each_supported_sample_rate() {
        for rate in [16000, 44100, 48000] {
            let recorder = fixture(rate);
            let recorded = (0..rate as usize * 29 / 4)
                .map(|i| (i % 997) as f32 / 997.)
                .collect::<Vec<_>>();
            *recorder.samples.lock().unwrap() = recorded.clone();
            let tail = recorder.capture_tail(Duration::from_secs(6));
            let start = rate as usize * 5 / 4;
            assert_eq!(tail.samples, recorded[start..]);
            assert_eq!(tail.rate, rate);
            assert_eq!(tail.offset_seconds(), 1.25);
            assert_eq!(tail.duration_seconds(), 6.);
            // A preview snapshot must not drain the final take's original PCM.
            assert_eq!(recorder.capture().samples, recorded);
        }
    }

    #[test]
    fn tail_capture_handles_short_empty_and_zero_length_windows() {
        for rate in [16000, 44100, 48000] {
            let recorder = fixture(rate);
            let recorded = recorder.capture().samples;
            let short = recorder.capture_tail(Duration::from_secs(6));
            assert_eq!(short.samples, recorded);
            assert_eq!(short.offset_seconds(), 0.);
            assert_eq!(short.duration_seconds(), 32. / f64::from(rate));

            let zero = recorder.capture_tail(Duration::ZERO);
            assert!(zero.samples.is_empty());
            assert_eq!(zero.offset_seconds(), 32. / f64::from(rate));
            assert_eq!(zero.duration_seconds(), 0.);
            assert_eq!(recorder.capture().samples, recorded);

            recorder.samples.lock().unwrap().clear();
            let empty = recorder.capture_tail(Duration::from_secs(6));
            assert!(empty.samples.is_empty());
            assert_eq!(empty.offset_seconds(), 0.);
            assert_eq!(empty.duration_seconds(), 0.);
        }
    }

    #[test]
    fn tail_capture_rounds_fractional_windows_down_to_complete_samples() {
        for (rate, expected) in [(16000, 16), (44100, 44), (48000, 48)] {
            let recorder = fixture(rate);
            let recorded = (0..100).map(|i| i as f32).collect::<Vec<_>>();
            *recorder.samples.lock().unwrap() = recorded.clone();
            let tail = recorder.capture_tail(Duration::from_millis(1));
            assert_eq!(tail.samples, recorded[100 - expected..]);
            assert_eq!(tail.start_sample, 100 - expected);
            assert!(tail.duration_seconds() <= 0.001);
            assert_eq!(tail.duration_seconds(), expected as f64 / f64::from(rate));
            let less_than_one_sample = recorder.capture_tail(Duration::from_nanos(1));
            assert!(less_than_one_sample.samples.is_empty());
            assert_eq!(less_than_one_sample.start_sample, 100);
        }
    }

    #[test]
    fn oversized_tail_duration_never_overflows_or_extends_recorded_audio() {
        for rate in [16000, 44100, 48000, u32::MAX] {
            let recorder = fixture(rate);
            let recorded = recorder.capture().samples;
            let tail = recorder.capture_tail(Duration::MAX);
            assert_eq!(tail.samples, recorded);
            assert_eq!(tail.offset_seconds(), 0.);
            assert_eq!(tail.duration_seconds(), 32. / f64::from(rate));
        }
    }

    #[test]
    fn tail_snapshot_and_metadata_stay_independent_of_later_capture() {
        let recorder = fixture(16000);
        let recorded = (0..100).map(|i| i as f32).collect::<Vec<_>>();
        *recorder.samples.lock().unwrap() = recorded.clone();
        let mut tail = recorder.capture_tail(Duration::from_millis(1));
        {
            let mut current = recorder.samples.lock().unwrap();
            current.fill(-1.);
            current.extend([101., 102.]);
        }
        assert_eq!(tail.samples, recorded[84..]);
        assert_eq!(tail.offset_seconds(), 84. / 16000.);
        assert_eq!(tail.duration_seconds(), 0.001);
        tail.samples.fill(0.);
        assert_eq!(recorder.samples.lock().unwrap()[84], -1.);
        assert_eq!(recorder.capture().offset_seconds(), 0.);
    }

    #[test]
    fn captured_pcm_is_independent_and_preserves_existing_resampler_output() {
        // Fixed reference PCM from the original windowed-sinc implementation.
        // These cover direct-rate, 44.1kHz and 48kHz input with both polarities.
        let references: [(u32, &[i16]); 3] = [
            (
                16000,
                &[
                    -53, 8038, 16725, 24125, 32767, 24293, 16508, 8150, 25, -8241, -16290, -24705,
                    -32619, -24709, -16278, -8248, 0, 8248, 16278, 24709, 32610, 24740, 16228,
                    8304, -25, -8309, -16071, -25157, -31915, -25356, -15827, -8525,
                ],
            ),
            (
                44100,
                &[
                    2646, 21827, 22961, -2604, -25307, -20071, 5063, 26476, 17819, -7630, -26695,
                ],
            ),
            (
                48000,
                &[
                    3487, 22818, 19472, -9854, -27410, -9842, 18684, 25012, 42, -24833,
                ],
            ),
        ];
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        for (rate, expected) in references {
            let recorder = fixture(rate);
            let capture = recorder.capture();
            recorder.samples.lock().unwrap().fill(0.);
            let path = root.join(format!("{rate}.wav"));
            capture.write(&path).unwrap();
            let mut reader = hound::WavReader::open(&path).unwrap();
            assert_eq!(reader.spec().sample_rate, 16000);
            assert_eq!(reader.spec().channels, 1);
            assert_eq!(reader.spec().bits_per_sample, 16);
            assert_eq!(reader.spec().sample_format, hound::SampleFormat::Int);
            assert_eq!(
                reader
                    .samples::<i16>()
                    .map(Result::unwrap)
                    .collect::<Vec<_>>(),
                expected
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stop_capture_joins_device_thread_before_new_capture_can_start() {
        let mut recorder = fixture(48000);
        let (stop, stopped) = mpsc::channel();
        recorder.stop = stop;
        let closed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let device_closed = closed.clone();
        recorder.join = Some(std::thread::spawn(move || {
            stopped.recv().unwrap();
            device_closed.store(true, Ordering::SeqCst);
        }));
        recorder.stop_capture();
        assert!(closed.load(Ordering::SeqCst));
        assert!(recorder.join.is_none());
    }
}
