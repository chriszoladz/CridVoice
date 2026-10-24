"""CridVoice private JSON-lines speech worker. No listening socket, no telemetry."""
from __future__ import annotations
import argparse
import contextlib
import json
import os
from pathlib import Path
import sys
import wave

os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')
os.environ.setdefault('ORT_DISABLE_TELEMETRY', '1')
_dll_handles = []
_models = {}
_warmed_models = set()
MAX_REQUEST_CHARS = 256 * 1024
MAX_PREVIEW_SAMPLES = 6 * 16000
_preview_worker = False

# Only application-authored validation messages may cross the error boundary.
VALIDATION_ERRORS = frozenset((
    'Audio path is outside the private recording directory.',
    'Audio file is missing or too large.',
    'Audio must be mono 16-bit PCM at 16 kHz.',
    'Unknown speech model.',
    'Download the selected speech model in Models before recording.',
    'Speech device must be CPU or CUDA.',
    'Unsupported dictation language.',
    'Unknown speech operation.',
    'Speech request must be a JSON object.',
    'Speech request is too large.',
    'Live preview requires the dedicated CPU model and preview mode.',
    'Live preview audio must be no longer than six seconds.',
))


def cache_status(request: dict) -> dict:
    loaded = next(iter(_models), None)
    return {
        'modelLoaded': (request.get('modelId'), request.get('device', 'cpu')) in _models,
        'loadedModel': {'modelId': loaded[0], 'device': loaded[1]} if loaded else None,
    }


def safe_error(exc: Exception) -> tuple[str, str]:
    """Classify transient exception text, never return library text or paths."""
    message = str(exc)
    lowered = message.lower()
    if isinstance(exc, json.JSONDecodeError):
        return 'invalid_request', 'Speech request is not valid JSON.'
    if isinstance(exc, ValueError) and message in VALIDATION_ERRORS:
        return 'invalid_request', message
    if 'out of memory' in lowered or 'cuda_error_out_of_memory' in lowered:
        return 'gpu_memory', 'GPU memory is full. Close other GPU workloads, select a smaller model, or choose CPU.'
    if 'cublas' in lowered or 'cudnn' in lowered or 'cudart' in lowered:
        return 'nvidia_runtime', 'NVIDIA libraries are unavailable. Download NVIDIA speech runtime in Models, then retry, or select CPU.'
    if isinstance(exc, ImportError) or 'dll load failed' in lowered:
        return 'python_dependency', 'Packaged speech dependencies could not load. Restore the complete CridVoice runtime.'
    if isinstance(exc, PermissionError):
        return 'permission', 'Speech service access was denied. Check data and model-folder permissions.'
    if 'cuda' in lowered:
        return 'graphics_backend', 'NVIDIA inference failed. Update your NVIDIA driver, check the speech runtime, or choose CPU.'
    if isinstance(exc, (KeyError, TypeError)):
        return 'invalid_request', 'Speech request has invalid or missing fields.'
    return 'inference_failed', 'Speech recognition failed. Check the selected model and runtime, or try CPU.'


def configure_dlls(runtime: Path) -> None:
    if os.name != 'nt' or not runtime.exists():
        return
    for directory in sorted({p.parent for p in runtime.rglob('*.dll')}):
        _dll_handles.append(os.add_dll_directory(str(directory)))
        os.environ['PATH'] = str(directory) + os.pathsep + os.environ.get('PATH', '')


def configure_worker(root: Path, preview_worker: bool) -> None:
    global _preview_worker
    _preview_worker = preview_worker
    if preview_worker:
        # This separate process never loads the selected final/GPU model.
        for name in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
            os.environ[name] = '2'
    else:
        configure_dlls(root / 'models' / 'nvidia-runtime')


def validate_audio(path: Path, audio_root: Path) -> Path:
    resolved = path.resolve()
    if not resolved.is_relative_to(audio_root.resolve()) or resolved.suffix.lower() != '.wav':
        raise ValueError('Audio path is outside the private recording directory.')
    if not resolved.is_file() or resolved.stat().st_size > 64 * 1024 * 1024:
        raise ValueError('Audio file is missing or too large.')
    return resolved


def load_audio(path: Path, max_samples=None):
    import numpy as np
    with wave.open(str(path), 'rb') as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2 or source.getframerate() != 16000:
            raise ValueError('Audio must be mono 16-bit PCM at 16 kHz.')
        if max_samples is not None and source.getnframes() > max_samples:
            raise ValueError('Live preview audio must be no longer than six seconds.')
        return np.frombuffer(source.readframes(source.getnframes()), dtype='<i2').astype(np.float32) / 32768.0


def speech_dependencies():
    import numpy as np
    import onnxruntime
    onnxruntime.disable_telemetry_events()
    from faster_whisper import WhisperModel
    return np, WhisperModel


def model_spec(request: dict, root: Path):
    model_id = request.get('modelId', '')
    allowed = ('whisper-preview',) if _preview_worker else ('whisper-small', 'whisper-turbo')
    if model_id not in allowed:
        raise ValueError('Unknown speech model.')
    if _preview_worker and (request.get('device') != 'cpu' or request.get('preview') is not True):
        raise ValueError('Live preview requires the dedicated CPU model and preview mode.')
    model_dir = root / 'models' / model_id
    if not (model_dir / '.installed').exists():
        raise ValueError('Download the selected speech model in Models before recording.')
    device = request.get('device', 'cpu')
    if device not in ('cuda', 'cpu'):
        raise ValueError('Speech device must be CPU or CUDA.')
    return (model_id, device), model_dir


def cached_model(model_key, model_dir: Path, model_class):
    if model_key not in _models:
        _models.clear()
        _warmed_models.clear()
        import gc
        gc.collect()
        _models[model_key] = model_class(str(model_dir), device=model_key[1],
            compute_type='int8_float16' if model_key[1] == 'cuda' else 'int8',
            cpu_threads=2 if _preview_worker else min(max(1, os.cpu_count() or 4), 16), local_files_only=True)
    return _models[model_key]


def warm_model(request: dict, root: Path) -> dict:
    model_key, model_dir = model_spec(request, root)
    np, model_class = speech_dependencies()
    model = cached_model(model_key, model_dir, model_class)
    if model_key not in _warmed_models:
        from faster_whisper.vad import get_speech_timestamps
        # Exercise the same lazy ONNX VAD as production, then force one short
        # encoder/decoder pass. Zero audio is internal and never saved; no
        # microphone, caller-supplied audio, transcript, or history is involved.
        audio = np.zeros(16000, dtype=np.float32)
        get_speech_timestamps(audio, sampling_rate=16000, min_silence_duration_ms=450)
        segments, _ = model.transcribe(audio, language='en', task='transcribe',
            beam_size=1, best_of=1, temperature=0, vad_filter=False,
            condition_on_previous_text=False, without_timestamps=True,
            no_speech_threshold=None, log_prob_threshold=None,
            compression_ratio_threshold=None, max_new_tokens=1)
        for _ in segments:
            pass
        _warmed_models.add(model_key)
    return {'ready': True, 'warmed': True, **cache_status(request)}


def transcribe(request: dict, root: Path) -> dict:
    if _preview_worker or request.get('modelId') == 'whisper-preview':
        model_spec(request, root)
    np, model_class = speech_dependencies()
    path = validate_audio(Path(request['audio']), root / 'recordings')
    audio = load_audio(path, MAX_PREVIEW_SAMPLES) if _preview_worker else load_audio(path)
    if audio.size < 3200 or np.sqrt(np.mean(audio * audio)) < 0.0005:
        return {'text': '', 'language': request.get('language', 'auto'), 'languageProbability': 0, **cache_status(request)}
    model_key, model_dir = model_spec(request, root)
    language = request.get('language', 'auto')
    if language not in ('auto', 'en', 'pl'):
        raise ValueError('Unsupported dictation language.')
    model = cached_model(model_key, model_dir, model_class)
    vocabulary = request.get('vocabulary', [])
    hints = ', '.join(v['word'] for v in vocabulary if isinstance(v, dict) and 'word' in v)[:1000]
    options = dict(language=None if language == 'auto' else language,
        task='transcribe', beam_size=5,
        vad_filter=True, vad_parameters={'min_silence_duration_ms': 450},
        condition_on_previous_text=True, initial_prompt='English and Polish dictation. ' + hints,
        hallucination_silence_threshold=1.5, no_speech_threshold=0.6)
    if request.get('preview'):
        # Provisional text needs one greedy pass, without timestamp tokens or
        # the library's multi-temperature/candidate fallback. Final recognition
        # keeps its original decoding options and independently reads all audio.
        options.update(beam_size=1, best_of=1, temperature=0,
                       condition_on_previous_text=False, without_timestamps=True)
    if _preview_worker:
        options['max_new_tokens'] = 64
    segments, info = model.transcribe(audio, **options)
    text = ' '.join(s.text.strip() for s in segments).strip()
    return {'text': text, 'language': info.language, 'languageProbability': info.language_probability, **cache_status(request)}


def handle(request: dict, root: Path) -> dict:
    op = request.get('op')
    if op == 'health':
        return {'ready': True, 'python': sys.version.split()[0], **cache_status(request)}
    if op == 'unload':
        _models.clear()
        _warmed_models.clear()
        return {'ready': True, **cache_status(request)}
    if op == 'warm_model':
        return warm_model(request, root)
    if op == 'transcribe':
        return transcribe(request, root)
    raise ValueError('Unknown speech operation.')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', required=True)
    parser.add_argument('--preview-worker', action='store_true')
    args = parser.parse_args()
    root = Path(args.data_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    configure_worker(root, args.preview_worker)
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
    # Keep a private duplicate for JSON responses, and move descriptor 1 to
    # stderr so native-library writes cannot become protocol responses.
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), 'w', encoding='utf-8', buffering=1)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    while True:
        line = sys.stdin.readline(MAX_REQUEST_CHARS + 1)
        if not line:
            break
        request = {}
        try:
            if len(line) > MAX_REQUEST_CHARS:
                while not line.endswith('\n'):
                    line = sys.stdin.readline(MAX_REQUEST_CHARS + 1)
                    if not line:
                        break
                raise ValueError('Speech request is too large.')
            parsed = json.loads(line)
            if not isinstance(parsed, dict):
                raise ValueError('Speech request must be a JSON object.')
            request = parsed
            with contextlib.redirect_stdout(sys.stderr):
                result = handle(request, root)
            response = {'id': request.get('id'), 'ok': True, 'result': result}
        except Exception as exc:
            category, message = safe_error(exc)
            print('cridvoice-diagnostic: ' + category, file=sys.stderr, flush=True)
            response = {'id': request.get('id'), 'ok': False, 'error': message}
        protocol.write(json.dumps(response, ensure_ascii=False) + '\n')
    protocol.close()


if __name__ == '__main__':
    main()
