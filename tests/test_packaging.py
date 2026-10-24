"""Release rebuilding must preserve a portable application's existing data."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import stat
import unittest
from unittest.mock import patch


class PortableDataSafetyTests(unittest.TestCase):
    def test_generated_read_only_directory_can_be_rebuilt(self):
        source = Path(__file__).resolve().parents[1] / 'scripts/package_portable.py'
        spec = importlib.util.spec_from_file_location('package_portable_readonly_test', source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / 'release/CridVoice-test-portable'
            docs = output / 'docs'
            docs.mkdir(parents=True)
            file = docs / 'README.md'
            file.write_text('Generated documentation')
            os.chmod(file, stat.S_IRUSR)
            os.chmod(docs, stat.S_IRUSR | stat.S_IXUSR)
            with patch.object(module, 'ROOT', root):
                module.remove_generated_output(output)
            self.assertFalse(output.exists())

    def test_rebuilding_a_used_portable_folder_preserves_user_data(self):
        source = Path(__file__).resolve().parents[1] / 'scripts/package_portable.py'
        spec = importlib.util.spec_from_file_location('package_portable_test', source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / 'src-tauri/target/x86_64-pc-windows-msvc/release/cridvoice.exe'
            binary.parent.mkdir(parents=True)
            binary.write_bytes(b'build-test-placeholder')
            (root / 'package.json').write_text(json.dumps({'version': '0.1.1'}))
            history = root / 'release/CridVoice-0.1.1-portable/data/history.sqlite3'
            history.parent.mkdir(parents=True)
            history.write_bytes(b'preserve-test-history')
            with patch.object(module, 'ROOT', root), patch('sys.argv', ['package_portable.py']):
                with self.assertRaisesRegex(SystemExit, 'contains user data'):
                    module.main()
            self.assertEqual(history.read_bytes(), b'preserve-test-history')


if __name__ == '__main__':
    unittest.main()
