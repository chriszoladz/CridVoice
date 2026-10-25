import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import Mock, patch
import wave

import numpy as np

SERVICE = Path(__file__).resolve().parents[1] / 'src-tauri/resources/service/speech.py'
spec = importlib.util.spec_from_file_location('warm_speech', SERVICE)
speech = importlib.util.module_from_spec(spec)
spec.loader.exec_module(speech)


class SpeechWarmBoundaryTests(unittest.TestCase):
    def setUp(self):
        speech._models.clear()
        speech._warmed_models.clear()
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        for model_id in ('whisper-small', 'whisper-turbo'):
            model_dir = self.root / 'models' / model_id
            model_dir.mkdir(parents=True)
            (model_dir / '.installed').touch()
        self.request = {'op': 'warm_model', 'modelId': 'whisper-turbo', 'device': 'cuda'}
        self.consumed = []
        self.model = Mock()
        self.model.transcribe.side_effect = self.transcribe_segments
        self.factory = Mock(return_value=self.model)
        self.vad = Mock(return_value=[])
        self.dependencies = patch.object(speech, 'speech_dependencies', return_value=(np, self.factory))
        self.vad_module = patch.dict('sys.modules', {
            'faster_whisper.vad': types.SimpleNamespace(get_speech_timestamps=self.vad),
        })
        self.dependencies.start()
        self.vad_module.start()

    def tearDown(self):
        self.vad_module.stop()
        self.dependencies.stop()
        speech._models.clear()
        speech._warmed_models.clear()
        self.temporary.cleanup()

    def transcribe_segments(self, audio, **options):
        def segments():
            self.consumed.append(options)
            yield types.SimpleNamespace(text='DISCARDED_WARM_OUTPUT')
        return segments(), types.SimpleNamespace(language='en', language_probability=1)

    def audio_fixture(self, samples):
        audio_path = self.root / 'recordings' / 'public.wav'
        audio_path.parent.mkdir(exist_ok=True)
        with wave.open(str(audio_path), 'wb') as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16000)
            audio.writeframes(np.asarray(samples, dtype='<i2').tobytes())
        return str(audio_path)

    def final_options(self, language=None):
        return dict(language=language, task='transcribe', beam_size=5,
                    vad_filter=True, vad_parameters={'min_silence_duration_ms': 450},
                    condition_on_previous_text=True,
                    initial_prompt='English and Polish dictation. CridVoice',
                    hallucination_silence_threshold=1.5, no_speech_threshold=0.6)

    def test_warm_uses_only_synthetic_audio_consumes_output_and_reuses_cache(self):
        with patch.object(speech, 'load_audio', side_effect=AssertionError('Warm must not read caller audio')):
            first = speech.handle({**self.request, 'audio': 'private.wav'}, self.root)
            second = speech.handle(self.request, self.root)
        self.assertEqual(first, second)
        self.assertEqual(first, {'ready': True, 'warmed': True, 'modelLoaded': True,
                                 'loadedModel': {'modelId': 'whisper-turbo', 'device': 'cuda'}})
        self.assertNotIn('DISCARDED_WARM_OUTPUT', json.dumps(first))
        self.factory.assert_called_once()
        self.assertEqual(self.factory.call_args.kwargs['compute_type'], 'int8_float16')
        self.assertTrue(self.factory.call_args.kwargs['local_files_only'])
        self.assertGreaterEqual(self.factory.call_args.kwargs['cpu_threads'], 1)
        self.assertLessEqual(self.factory.call_args.kwargs['cpu_threads'], 16)
        self.vad.assert_called_once()
        audio = self.vad.call_args.args[0]
        self.assertEqual((audio.shape, audio.dtype), ((16000,), np.dtype('float32')))
        self.assertFalse(np.any(audio))
        self.assertEqual(self.vad.call_args.kwargs, {'sampling_rate': 16000, 'min_silence_duration_ms': 450})
        self.model.transcribe.assert_called_once()
        self.assertIs(self.model.transcribe.call_args.args[0], audio)
        options = self.consumed[0]
        self.assertFalse(options['vad_filter'])
        self.assertFalse(options['condition_on_previous_text'])
        self.assertEqual((options['language'], options['beam_size'], options['max_new_tokens']), ('en', 1, 1))
        self.assertIsNone(options['no_speech_threshold'])

    def test_invalid_or_missing_model_is_rejected_before_dependencies_load(self):
        invalid = [({'modelId': 'unknown'}, 'Unknown speech model.'),
                   ({'device': 'auto'}, 'Speech device must be CPU or CUDA.'),
                   ({'modelId': 'whisper-small'}, 'Download the selected speech model in Models before recording.')]
        (self.root / 'models' / 'whisper-small' / '.installed').unlink()
        with patch.object(speech, 'speech_dependencies', side_effect=AssertionError('Invalid request imported inference')):
            for change, message in invalid:
                with self.subTest(change=change), self.assertRaisesRegex(ValueError, message):
                    speech.handle({**self.request, **change}, self.root)
        self.assertEqual(speech._models, {})
        self.assertEqual(speech._warmed_models, set())

    def test_model_device_switch_and_unload_each_require_a_new_warm_pass(self):
        speech.handle(self.request, self.root)
        cpu = {**self.request, 'device': 'cpu'}
        speech.handle(cpu, self.root)
        self.assertEqual(self.factory.call_args.kwargs['compute_type'], 'int8')
        self.assertEqual(speech._warmed_models, {('whisper-turbo', 'cpu')})
        small = {**cpu, 'modelId': 'whisper-small'}
        speech.handle(small, self.root)
        unloaded = speech.handle({'op': 'unload'}, self.root)
        self.assertIsNone(unloaded['loadedModel'])
        self.assertFalse(speech._warmed_models)
        speech.handle(small, self.root)
        self.assertEqual(self.factory.call_count, 4)
        self.assertEqual(len(self.consumed), 4)

    def test_actual_transcription_reuses_warm_model_and_preserves_production_options(self):
        speech.handle(self.request, self.root)
        audio_path = self.audio_fixture(np.full(16000, 512))
        result = speech.handle({**self.request, 'op': 'transcribe', 'audio': audio_path,
                               'language': 'auto', 'preview': False,
                               'vocabulary': [{'word': 'CridVoice'}]}, self.root)
        self.factory.assert_called_once()
        self.assertEqual(self.consumed[-1], self.final_options())
        self.assertTrue(result['modelLoaded'])

    def test_preview_is_one_greedy_text_pass_and_cannot_change_final_options(self):
        speech.handle(self.request, self.root)
        audio_path = self.audio_fixture(np.full(16000, 512))
        request = {**self.request, 'op': 'transcribe', 'audio': audio_path,
                   'vocabulary': [{'word': 'CridVoice'}]}
        for language in ('auto', 'en', 'pl'):
            with self.subTest(language=language):
                result = speech.handle({**request, 'preview': True, 'language': language}, self.root)
                expected = self.final_options(None if language == 'auto' else language)
                expected.update(beam_size=1, best_of=1, temperature=0,
                                condition_on_previous_text=False, without_timestamps=True)
                self.assertEqual(self.consumed[-1], expected)
                self.assertTrue(result['modelLoaded'])
        speech.handle({**request, 'language': 'auto'}, self.root)
        self.assertEqual(self.consumed[-1], self.final_options())
        self.factory.assert_called_once()
        self.vad.assert_called_once()  # Warming still happens only once.
        self.assertEqual(self._model_audio_lengths(), [16000] * 5)

    def _model_audio_lengths(self):
        return [len(call.args[0]) for call in self.model.transcribe.call_args_list]

    def test_empty_or_quiet_preview_never_loads_or_decodes_a_model(self):
        for samples in (np.zeros(0), np.full(3199, 512), np.zeros(16000), np.full(16000, 5)):
            with self.subTest(sample_count=len(samples), maximum=int(samples.max(initial=0))):
                audio_path = self.audio_fixture(samples)
                result = speech.handle({**self.request, 'op': 'transcribe', 'audio': audio_path,
                                       'preview': True, 'language': 'auto'}, self.root)
                self.assertEqual(result['text'], '')
                self.assertFalse(result['modelLoaded'])
                self.assertIsNone(result['loadedModel'])
        self.factory.assert_not_called()
        self.model.transcribe.assert_not_called()

    def test_no_speech_preview_returns_empty_without_fabricating_transcript(self):
        audio_path = self.audio_fixture(np.full(16000, 512))
        self.model.transcribe.return_value = (iter(()), types.SimpleNamespace(language='pl', language_probability=0.4))
        self.model.transcribe.side_effect = None
        result = speech.handle({**self.request, 'op': 'transcribe', 'audio': audio_path,
                               'preview': True, 'language': 'auto'}, self.root)
        self.assertEqual(result['text'], '')
        self.assertEqual((result['language'], result['languageProbability']), ('pl', 0.4))
        self.assertTrue(result['modelLoaded'])

    def test_failed_lazy_decode_is_not_marked_warm_and_retry_consumes_again(self):
        def failed_segments(audio, **options):
            def segments():
                raise RuntimeError('PRIVATE_NATIVE_DETAIL')
                yield
            return segments(), None
        self.model.transcribe.side_effect = failed_segments
        with self.assertRaises(RuntimeError):
            speech.handle(self.request, self.root)
        self.assertFalse(speech._warmed_models)
        self.model.transcribe.side_effect = self.transcribe_segments
        result = speech.handle(self.request, self.root)
        self.assertTrue(result['warmed'])
        self.factory.assert_called_once()
        self.assertEqual(self.model.transcribe.call_count, 2)

    def test_health_never_imports_inference_or_warms_a_model(self):
        with patch.object(speech, 'speech_dependencies', side_effect=AssertionError('Health imported inference')):
            result = speech.handle({'op': 'health'}, self.root)
        self.assertTrue(result['ready'])
        self.assertFalse(result['modelLoaded'])
        self.factory.assert_not_called()
        self.vad.assert_not_called()


if __name__ == '__main__':
    unittest.main()
