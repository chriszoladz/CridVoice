import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import wave
SERVICE=Path(__file__).resolve().parents[1]/'src-tauri/resources/service/speech.py'
spec=importlib.util.spec_from_file_location('speech',SERVICE);speech=importlib.util.module_from_spec(spec);spec.loader.exec_module(speech)
class SpeechBoundaryTests(unittest.TestCase):
    def test_audio_cannot_escape_recording_directory(self):
        with tempfile.TemporaryDirectory() as root:
            d=Path(root);(d/'recordings').mkdir();outside=d/'private.wav';outside.write_bytes(b'')
            with self.assertRaises(ValueError):speech.validate_audio(outside,d/'recordings')
    def test_worker_health_and_errors_are_json_lines(self):
        with tempfile.TemporaryDirectory() as root:
            p=subprocess.run([sys.executable,str(SERVICE),'--data-dir',root],input='{"id":"1","op":"health"}\n{"id":"2","op":"unknown"}\n',text=True,capture_output=True,timeout=15)
            self.assertEqual(p.returncode,0,p.stderr);lines=[json.loads(s) for s in p.stdout.splitlines()];self.assertTrue(lines[0]['ok']);self.assertTrue(lines[0]['result']['ready']);self.assertFalse(lines[1]['ok']);self.assertEqual(lines[1]['id'],'2')
    def test_invalid_json_does_not_kill_worker(self):
        with tempfile.TemporaryDirectory() as root:
            p=subprocess.run([sys.executable,str(SERVICE),'--data-dir',root],input='oops\n{"id":"ok","op":"health"}\n',text=True,capture_output=True,timeout=15)
            lines=[json.loads(s) for s in p.stdout.splitlines()];self.assertFalse(lines[0]['ok']);self.assertTrue(lines[1]['ok'])
    def test_non_object_json_does_not_kill_worker(self):
        with tempfile.TemporaryDirectory() as root:
            for malformed in ('[]', 'null', '"hello"', '42', 'true'):
                with self.subTest(request=malformed):
                    p=subprocess.run([sys.executable,str(SERVICE),'--data-dir',root],input=malformed+'\n{"id":"after","op":"health"}\n',text=True,capture_output=True,timeout=15)
                    self.assertEqual(p.returncode,0,p.stderr)
                    lines=[json.loads(s) for s in p.stdout.splitlines()]
                    self.assertFalse(lines[0]['ok']);self.assertEqual(lines[0]['error'],'Speech request must be a JSON object.')
                    self.assertTrue(lines[1]['ok']);self.assertEqual(lines[1]['id'],'after')
    def test_oversized_line_is_drained_and_following_request_survives(self):
        with tempfile.TemporaryDirectory() as root:
            p=subprocess.run([sys.executable,str(SERVICE),'--data-dir',root],input='x'*(speech.MAX_REQUEST_CHARS*3)+'\n{"id":"after","op":"health"}\n',text=True,capture_output=True,timeout=15)
            self.assertEqual(p.returncode,0,p.stderr)
            lines=[json.loads(s) for s in p.stdout.splitlines()]
            self.assertEqual(len(lines),2);self.assertFalse(lines[0]['ok']);self.assertTrue(lines[1]['ok'])
    def test_error_messages_never_echo_library_text_or_private_fields(self):
        for exc in (RuntimeError('PRIVATE_TRANSCRIPT PRIVATE_KEY'),ValueError('PRIVATE_CONTEXT'),ImportError('PRIVATE_PATH'),RuntimeError('cudnn PRIVATE_KEY'),RuntimeError('CUDA out of memory PRIVATE_PROMPT')):
            with self.subTest(exception=type(exc).__name__):
                category,message=speech.safe_error(exc)
                self.assertNotIn('PRIVATE_',category+message)
        self.assertEqual(speech.safe_error(RuntimeError('CUDA out of memory PRIVATE_PROMPT'))[0],'gpu_memory')
    def test_native_stdout_writes_cannot_pollute_protocol(self):
        with tempfile.TemporaryDirectory() as root:
            code=('import importlib.util,os,sys;'
                  'spec=importlib.util.spec_from_file_location("speech",sys.argv[1]);'
                  'speech=importlib.util.module_from_spec(spec);spec.loader.exec_module(speech);'
                  'speech.handle=lambda request,root:(os.write(1,b"native library output\\n") and {"ready":True});'
                  'sys.argv=[sys.argv[1],"--data-dir",sys.argv[2]];speech.main()')
            p=subprocess.run([sys.executable,'-c',code,str(SERVICE),root],input='{"id":"native","op":"health"}\n',text=True,capture_output=True,timeout=15)
            self.assertEqual(p.returncode,0,p.stderr)
            lines=[json.loads(s) for s in p.stdout.splitlines()]
            self.assertEqual(len(lines),1);self.assertTrue(lines[0]['ok']);self.assertIn('native library output',p.stderr)
    def test_cache_status_reports_actual_loaded_identity(self):
        original=speech._models.copy()
        try:
            speech._models.clear()
            status=speech.cache_status({'modelId':'whisper-small','device':'cpu'})
            self.assertFalse(status['modelLoaded']);self.assertIsNone(status['loadedModel'])
            speech._models[('whisper-small','cpu')]=object()
            status=speech.cache_status({'modelId':'whisper-turbo','device':'cuda'})
            self.assertFalse(status['modelLoaded'])
            self.assertEqual(status['loadedModel'],{'modelId':'whisper-small','device':'cpu'})
            self.assertTrue(speech.cache_status({'modelId':'whisper-small','device':'cpu'})['modelLoaded'])
            self.assertIsNone(speech.handle({'op':'unload'},Path('.'))['loadedModel'])
        finally:
            speech._models.clear();speech._models.update(original)
    def test_silent_take_does_not_claim_a_model_was_loaded(self):
        from unittest.mock import patch
        import types
        original=speech._models.copy()
        try:
            speech._models.clear()
            fake_onnx=types.SimpleNamespace(disable_telemetry_events=lambda:None)
            fake_whisper=types.SimpleNamespace(WhisperModel=lambda *args,**kwargs:self.fail('silent take must not load a model'))
            with tempfile.TemporaryDirectory() as root, patch.dict(sys.modules,{'onnxruntime':fake_onnx,'faster_whisper':fake_whisper}):
                path=Path(root)/'recordings'/'silent.wav';path.parent.mkdir()
                with wave.open(str(path),'wb') as audio:
                    audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(16000);audio.writeframes(b'\0'*8000)
                result=speech.transcribe({'audio':str(path),'modelId':'whisper-small','device':'cpu'},Path(root))
                self.assertEqual(result['text'],'');self.assertFalse(result['modelLoaded']);self.assertIsNone(result['loadedModel'])
        finally:
            speech._models.clear();speech._models.update(original)
    def test_pcm_audio_format_is_checked(self):
        with tempfile.TemporaryDirectory() as root:
            p=Path(root)/'audio.wav'
            with wave.open(str(p),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(16000);w.writeframes(b'\0'*640)
            with self.assertRaises(ValueError):speech.load_audio(p)
if __name__=='__main__':unittest.main()
