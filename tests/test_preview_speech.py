import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import Mock, patch
import wave

import numpy as np

SERVICE = Path(__file__).resolve().parents[1] / 'src-tauri/resources/service/speech.py'


def module(name):
    spec = importlib.util.spec_from_file_location(name, SERVICE)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


class PreviewWorkerTests(unittest.TestCase):
    def setUp(self):
        self.speech = module('isolated_preview_speech')
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        for identity in ('whisper-preview', 'whisper-small', 'whisper-turbo'):
            directory = self.root / 'models' / identity
            directory.mkdir(parents=True)
            (directory / '.installed').touch()
        self.model = Mock()
        self.model.transcribe.side_effect = lambda audio, **options: (
            iter([types.SimpleNamespace(text=' public fixture ')]),
            types.SimpleNamespace(language='pl', language_probability=0.9))
        self.factory = Mock(return_value=self.model)
        self.dependencies = patch.object(self.speech, 'speech_dependencies', return_value=(np, self.factory))
        self.dependencies.start()
        self.vad = Mock(return_value=[])
        self.vad_module = patch.dict('sys.modules', {
            'faster_whisper.vad': types.SimpleNamespace(get_speech_timestamps=self.vad)})
        self.vad_module.start()
        self.request = {'modelId': 'whisper-preview', 'device': 'cpu', 'preview': True}

    def tearDown(self):
        self.vad_module.stop()
        self.dependencies.stop()
        self.temporary.cleanup()

    def audio(self, count=16000, value=512):
        path = self.root / 'recordings' / 'public.wav'
        path.parent.mkdir(exist_ok=True)
        with wave.open(str(path), 'wb') as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16000)
            audio.writeframes(np.full(count, value, dtype='<i2').tobytes())
        return str(path)

    def test_preview_role_rejects_wrong_model_gpu_and_missing_preview_before_loading(self):
        self.speech._preview_worker = True
        for operation in ('warm_model', 'transcribe'):
            for invalid in ({'modelId': 'whisper-turbo'}, {'device': 'cuda'},
                            {'preview': False}, {'preview': None}):
                with self.subTest(operation=operation, invalid=invalid), self.assertRaises(ValueError):
                    self.speech.handle({**self.request, **invalid, 'op': operation}, self.root)
        self.factory.assert_not_called()
        self.assertEqual(self.speech._models, {})

    def test_main_role_rejects_tiny_even_for_silent_transcription(self):
        for operation in ('warm_model', 'transcribe'):
            with self.subTest(operation=operation), self.assertRaisesRegex(ValueError, 'Unknown speech model'):
                self.speech.handle({**self.request, 'op': operation, 'audio': self.audio(value=0)}, self.root)
        self.factory.assert_not_called()

    def test_preview_process_configuration_skips_cuda_and_limits_threads(self):
        with patch.dict(os.environ, {'OMP_NUM_THREADS': '16'}), patch.object(self.speech, 'configure_dlls') as dlls:
            self.speech.configure_worker(self.root, True)
            dlls.assert_not_called()
            self.assertTrue(self.speech._preview_worker)
            for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
                self.assertEqual(os.environ[key], '2')
            self.speech.configure_worker(self.root, False)
            dlls.assert_called_once_with(self.root / 'models' / 'nvidia-runtime')
            self.assertFalse(self.speech._preview_worker)

    def test_preview_cache_warms_once_stays_cpu_and_unloads_independently(self):
        self.speech._preview_worker = True
        first = self.speech.handle({**self.request, 'op': 'warm_model'}, self.root)
        second = self.speech.handle({**self.request, 'op': 'warm_model'}, self.root)
        self.assertEqual(first, second)
        self.assertEqual(first['loadedModel'], {'modelId': 'whisper-preview', 'device': 'cpu'})
        self.factory.assert_called_once()
        self.assertEqual(self.factory.call_args.kwargs['cpu_threads'], 2)
        self.assertEqual(self.factory.call_args.kwargs['compute_type'], 'int8')
        self.assertTrue(self.factory.call_args.kwargs['local_files_only'])
        self.assertEqual(self.model.transcribe.call_count, 1)
        self.assertEqual(self.model.transcribe.call_args.kwargs['max_new_tokens'], 1)
        self.speech.handle({'op': 'unload'}, self.root)
        self.assertFalse(self.speech._models)
        self.speech.handle({**self.request, 'op': 'warm_model'}, self.root)
        self.assertEqual(self.factory.call_count, 2)

    def test_preview_en_pl_and_auto_keep_guards_and_bounded_greedy_decode(self):
        self.speech._preview_worker = True
        path = self.audio(count=96000)
        for language in ('auto', 'en', 'pl'):
            with self.subTest(language=language):
                result = self.speech.handle({**self.request, 'op': 'transcribe', 'audio': path,
                                            'language': language, 'vocabulary': [{'word': 'CridVoice'}]}, self.root)
                self.assertEqual(self.model.transcribe.call_args.kwargs, {
                    'language': None if language == 'auto' else language, 'task': 'transcribe',
                    'beam_size': 1, 'best_of': 1, 'temperature': 0,
                    'vad_filter': True, 'vad_parameters': {'min_silence_duration_ms': 450},
                    'condition_on_previous_text': False, 'without_timestamps': True,
                    'initial_prompt': 'English and Polish dictation. CridVoice',
                    'hallucination_silence_threshold': 1.5, 'no_speech_threshold': 0.6,
                    'max_new_tokens': 64})
                self.assertEqual(result['text'], 'public fixture')
        self.factory.assert_called_once()

    def test_preview_rejects_over_six_seconds_without_model_decode(self):
        self.speech._preview_worker = True
        with self.assertRaisesRegex(ValueError, 'no longer than six seconds'):
            self.speech.handle({**self.request, 'op': 'transcribe', 'audio': self.audio(96001)}, self.root)
        self.factory.assert_not_called()

    def test_short_quiet_and_invalid_language_preview_keep_speech_safeguards(self):
        self.speech._preview_worker = True
        for count, value in ((0, 0), (3199, 512), (16000, 0), (16000, 5)):
            with self.subTest(count=count, value=value):
                result = self.speech.handle({**self.request, 'op': 'transcribe', 'audio': self.audio(count, value)}, self.root)
                self.assertEqual(result['text'], '')
                self.assertFalse(result['modelLoaded'])
        with self.assertRaisesRegex(ValueError, 'Unsupported dictation language'):
            self.speech.handle({**self.request, 'op': 'transcribe', 'audio': self.audio(), 'language': 'xx'}, self.root)
        self.factory.assert_not_called()

    def test_separate_preview_cache_cannot_replace_main_warm_model_or_final_options(self):
        main = module('isolated_final_speech')
        final_model = Mock()
        final_model.transcribe.side_effect = self.model.transcribe.side_effect
        final_factory = Mock(return_value=final_model)
        with patch.object(main, 'speech_dependencies', return_value=(np, final_factory)):
            main.handle({'op': 'warm_model', 'modelId': 'whisper-turbo', 'device': 'cuda'}, self.root)
            self.speech._preview_worker = True
            self.speech.handle({**self.request, 'op': 'warm_model'}, self.root)
            self.speech.handle({'op': 'unload'}, self.root)
            result = main.handle({'op': 'transcribe', 'modelId': 'whisper-turbo', 'device': 'cuda',
                                  'audio': self.audio(), 'language': 'auto'}, self.root)
        final_factory.assert_called_once()
        self.assertEqual(result['loadedModel'], {'modelId': 'whisper-turbo', 'device': 'cuda'})
        self.assertEqual(final_model.transcribe.call_args.kwargs, {
            'language': None, 'task': 'transcribe', 'beam_size': 5,
            'vad_filter': True, 'vad_parameters': {'min_silence_duration_ms': 450},
            'condition_on_previous_text': True, 'initial_prompt': 'English and Polish dictation. ',
            'hallucination_silence_threshold': 1.5, 'no_speech_threshold': 0.6})


if __name__ == '__main__':
    unittest.main()
