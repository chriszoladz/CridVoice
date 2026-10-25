"""Release intent, artifact corruption, and publication must fail safely."""
import copy
import contextlib
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import release_plan as plan
import release_assets as assets
import publish_release as publisher
import package_portable

COMMIT = 'a' * 40
BEFORE = 'b' * 40
VERSION = '0.1.20'


def versions(root, version=VERSION):
    (root / 'src-tauri').mkdir(parents=True, exist_ok=True)
    (root / 'package.json').write_text(json.dumps({'version': version}), encoding='utf-8')
    (root / 'package-lock.json').write_text(json.dumps({'version': version, 'packages': {'': {'version': version}}}), encoding='utf-8')
    (root / 'src-tauri/tauri.conf.json').write_text(json.dumps({'version': version}), encoding='utf-8')
    (root / 'src-tauri/Cargo.toml').write_text(f'[package]\nversion = "{version}"\n', encoding='utf-8')


def fake_pe(machine):
    result = bytearray(128)
    result[:2] = b'MZ'
    struct.pack_into('<I', result, 60, 64)
    result[64:68] = b'PE\0\0'
    struct.pack_into('<H', result, 68, machine)
    return bytes(result)


def build_fixture(root):
    versions(root)
    files = {'README.md': b'Public fixture documentation', 'THIRD-PARTY-NOTICES.md': b'Fixture notices',
             'docs/GUIDE.md': b'Public fixture guide', 'src-tauri/resources/model-catalog.json': b'[]',
             'src-tauri/resources/python/python.exe': fake_pe(0x8664),
             'src-tauri/resources/python/package/data/legitimate.txt': b'Legitimate library resource',
             'src-tauri/resources/service/speech.py': b'# fixture only', 'src-tauri/resources/help/index.html': b'<p>Help</p>',
             'src-tauri/target/x86_64-pc-windows-msvc/release/cridvoice.exe': fake_pe(0x8664),
             f'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/CridVoice_{VERSION}_x64-setup.exe': fake_pe(0x14c)}
    for name, data in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    with patch.object(package_portable, 'ROOT', root), patch('sys.argv', ['package_portable.py']), contextlib.redirect_stdout(io.StringIO()):
        package_portable.main()
    output = root / 'release/publish'
    with contextlib.redirect_stdout(io.StringIO()):
        assets.prepare(root, output, COMMIT)
    return output


class IntentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        versions(self.root)
        path = self.root / plan.REQUEST
        path.parent.mkdir()
        path.write_text(json.dumps({'version': VERSION, 'publish': True, 'request_id': '12345678-1234-4234-8234-123456789abc'}), encoding='utf-8')

    def invoke(self, event='push', ref='refs/heads/main', repo=plan.REPOSITORY, dispatch=False, changed=1):
        with patch.object(plan.subprocess, 'run') as run:
            run.side_effect = [type('Result', (), {'returncode': 0})(), type('Result', (), {'returncode': changed})()]
            return plan.plan(self.root, event, ref, repo, COMMIT, BEFORE, dispatch)

    def test_changed_explicit_request_on_main_publishes(self):
        self.assertTrue(self.invoke()['publish'])

    def test_pull_request_fork_and_other_branch_cannot_publish(self):
        for kwargs in [{'event': 'pull_request'}, {'repo': 'someone/CridVoice'}, {'ref': 'refs/heads/feature'}]:
            with self.subTest(**kwargs):
                self.assertFalse(self.invoke(**kwargs)['publish'])

    def test_unchanged_request_does_not_republish_on_later_commits(self):
        self.assertFalse(self.invoke(changed=0)['publish'])

    def test_dry_run_and_default_manual_run_do_not_publish(self):
        self.assertFalse(self.invoke(event='workflow_dispatch')['publish'])
        request = self.root / plan.REQUEST
        data = json.loads(request.read_text()); data['publish'] = False
        request.write_text(json.dumps(data), encoding='utf-8')
        self.assertFalse(self.invoke()['publish'])

    def test_explicit_dispatch_is_limited_to_main_and_this_repo(self):
        self.assertTrue(self.invoke(event='workflow_dispatch', dispatch=True)['publish'])
        self.assertFalse(self.invoke(event='workflow_dispatch', dispatch=True, repo='other/repo')['publish'])

    def test_invalid_request_versions_flags_and_unknown_fields_fail(self):
        path = self.root / plan.REQUEST
        original = json.loads(path.read_text())
        for changes in [{'publish': 'true'}, {'version': '0.1.19'}, {'extra': 'not allowed'}, {'request_id': '../bad'}]:
            path.write_text(json.dumps({**original, **changes}), encoding='utf-8')
            with self.subTest(changes=changes), self.assertRaises((ValueError, TypeError)):
                self.invoke()

    def test_duplicate_request_fields_and_mismatched_manifests_fail(self):
        (self.root / plan.REQUEST).write_text('{"publish":false,"publish":true}', encoding='utf-8')
        with self.assertRaises(ValueError): self.invoke()
        (self.root / 'src-tauri/tauri.conf.json').write_text('{"version":"0.1.19"}', encoding='utf-8')
        with self.assertRaises(ValueError): self.invoke()

    def test_version_cannot_be_used_as_path_or_shell_input(self):
        for value in ['../0.1.20', '0.1.20;command', '0.1.20\nnext', 'v0.1.20']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                assets.names(value)


class AssetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.folder = build_fixture(self.root)

    def test_five_verified_files_include_separate_installer_and_portable(self):
        info = assets.verify(self.folder, VERSION, COMMIT)
        self.assertEqual(len(list(self.folder.iterdir())), 5)
        self.assertTrue(info['unsigned'])
        self.assertTrue(info['portableResourcesVerified'])

    def test_changed_payload_or_manifest_is_rejected(self):
        target = self.folder / assets.names(VERSION)[0]
        target.write_bytes(target.read_bytes() + b'corruption')
        with self.assertRaises(ValueError): assets.verify(self.folder, VERSION, COMMIT)

    def test_unknown_files_and_wrong_source_are_rejected(self):
        with self.assertRaises(ValueError): assets.verify(self.folder, VERSION, BEFORE)
        (self.folder / 'settings.json').write_text('{}', encoding='utf-8')
        with self.assertRaises(ValueError): assets.verify(self.folder, VERSION, COMMIT)

    def test_prepare_preserves_existing_output(self):
        before = {p.name: p.read_bytes() for p in self.folder.iterdir()}
        with self.assertRaises(ValueError): assets.prepare(self.root, self.folder, COMMIT)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.folder.iterdir()})

    def test_traversal_duplicate_and_user_data_in_portable_are_rejected(self):
        app_hash = hashlib.sha256(fake_pe(0x8664)).hexdigest()
        for unwanted in ['../escape', f'CridVoice-{VERSION}-portable/data/history.sqlite3', f'CridVoice-{VERSION}-portable/./data/history.sqlite3', f'CridVoice-{VERSION}-portable/cridvoice.exe']:
            path = self.root / 'bad.zip'
            original = self.folder / assets.names(VERSION)[2]
            path.write_bytes(original.read_bytes())
            with zipfile.ZipFile(path, 'a') as archive: archive.writestr(unwanted, b'fixture')
            with self.subTest(path=unwanted), self.assertRaises(ValueError):
                assets.check_portable(path, VERSION, app_hash)


class FakeGitHub:
    def __init__(self):
        self.release = None
        self.tag = None
        self.files = {}
        self.events = []
        self.corrupt = False

    def api(self, path, method='GET', body=None, optional=False):
        if method == 'POST':
            self.events.append('create-draft')
            self.release = {**body, 'id': 7, 'assets': []}
        elif method == 'PATCH':
            self.events.append('publish')
            self.release.update(body)
            self.tag = self.release['target_commitish']
        elif '/git/ref/tags/' in path:
            return None if self.tag is None else {'object': {'type': 'commit', 'sha': self.tag}}
        return copy.deepcopy(self.release)

    def upload(self, tag, files):
        self.events.append('upload')
        for path in files:
            asset_id = len(self.files) + 1
            self.files[asset_id] = path.read_bytes()
            self.release['assets'].append({'id': asset_id, 'name': path.name, 'size': path.stat().st_size})

    def download(self, asset_id, destination):
        self.events.append('verify-download')
        destination.write_bytes(self.files[asset_id] + (b'corrupt' if self.corrupt else b''))


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = build_fixture(Path(self.temp.name))
        self.client = FakeGitHub()

    def publish(self):
        return publisher.publish(self.client, self.folder, VERSION, COMMIT)

    def test_uploads_are_verified_before_release_becomes_public(self):
        self.assertTrue(self.publish().endswith('/v' + VERSION))
        self.assertLess(self.client.events.index('verify-download'), self.client.events.index('publish'))
        self.assertFalse(self.client.release['draft'])
        self.assertTrue(self.client.release['prerelease'])
        self.assertEqual(self.client.release['make_latest'], 'false')

    def test_existing_tag_from_other_source_is_never_overwritten(self):
        self.client.tag = BEFORE
        with self.assertRaises(ValueError): self.publish()
        self.assertEqual(self.client.events, [])

    def test_unrelated_draft_is_preserved(self):
        self.client.release = {'id': 7, 'tag_name': 'v' + VERSION, 'body': 'An unrelated draft', 'draft': True, 'assets': []}
        with self.assertRaises(ValueError): self.publish()
        self.assertEqual(self.client.events, [])

    def test_matching_published_release_is_idempotent_without_writes(self):
        self.publish(); self.client.events.clear()
        self.publish()
        self.assertNotIn('create-draft', self.client.events)
        self.assertNotIn('upload', self.client.events)
        self.assertNotIn('publish', self.client.events)

    def test_corrupt_remote_asset_leaves_release_as_draft(self):
        self.client.corrupt = True
        with self.assertRaises(ValueError): self.publish()
        self.assertTrue(self.client.release['draft'])
        self.assertNotIn('publish', self.client.events)

    def test_tag_change_during_upload_prevents_publication(self):
        original = self.client.upload
        def changed_tag(tag, files):
            original(tag, files)
            self.client.tag = BEFORE
        self.client.upload = changed_tag
        with self.assertRaises(ValueError): self.publish()
        self.assertTrue(self.client.release['draft'])
        self.assertNotIn('publish', self.client.events)

    def test_failed_upload_resumes_only_same_verified_artifact_set(self):
        original = self.client.upload
        def partial(tag, files):
            original(tag, files[:2])
            raise RuntimeError('Fixture interrupted upload')
        self.client.upload = partial
        with self.assertRaises(RuntimeError): self.publish()
        self.client.upload = original
        self.publish()
        self.assertEqual(self.client.events.count('create-draft'), 1)
        self.assertEqual(len(self.client.release['assets']), 5)

    def test_unexpected_existing_assets_are_preserved(self):
        self.client.corrupt = True
        with self.assertRaises(ValueError): self.publish()
        self.client.corrupt = False
        self.client.release['assets'].append({'name': 'unrelated.txt', 'id': 100, 'size': 1})
        with self.assertRaises(ValueError): self.publish()
        self.assertNotIn('publish', self.client.events)

    def test_invalid_local_assets_never_call_github(self):
        (self.folder / assets.SUMS).write_text('changed', encoding='utf-8')
        with self.assertRaises(ValueError): self.publish()
        self.assertEqual(self.client.events, [])

    def test_api_failures_do_not_log_raw_response(self):
        result = type('Result', (), {'returncode': 1, 'stdout': '', 'stderr': 'private-response-placeholder'})()
        with patch.object(publisher.subprocess, 'run', return_value=result), self.assertRaises(RuntimeError) as caught:
            publisher.GitHub().api(publisher.PREFIX + 'releases')
        self.assertNotIn('private-response-placeholder', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
