"""Validate a browser-free release request without granting publication rights."""
import json
import os
from pathlib import Path
import re
import subprocess
import tomllib
import uuid

REPOSITORY = 'chriszoladz/CridVoice'
REQUEST = '.github/release-request.json'
VERSION = re.compile(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?\Z')
COMMIT = re.compile(r'[0-9a-f]{40}\Z')


def strict_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON fields are not allowed.')
            result[key] = value
        return result
    return json.loads(text, object_pairs_hook=pairs)


def read_version(root):
    package = strict_json((root / 'package.json').read_text(encoding='utf-8'))
    lock = strict_json((root / 'package-lock.json').read_text(encoding='utf-8'))
    tauri = strict_json((root / 'src-tauri/tauri.conf.json').read_text(encoding='utf-8'))
    cargo = tomllib.loads((root / 'src-tauri/Cargo.toml').read_text(encoding='utf-8'))
    version = package['version']
    if not isinstance(version, str) or len(version) > 64 or not VERSION.fullmatch(version):
        raise ValueError('Use a valid, bounded release version.')
    if any(value != version for value in [lock['version'], lock['packages']['']['version'], tauri['version'], cargo['package']['version']]):
        raise ValueError('App version manifests must agree before releasing.')
    return version


def plan(root, event, ref, repository, commit, before='', dispatch=False):
    version = read_version(root)
    if not COMMIT.fullmatch(commit):
        raise ValueError('A full immutable source commit is required.')
    result = {'version': version, 'commit': commit, 'publish': False}
    if repository != REPOSITORY or ref != 'refs/heads/main':
        return result
    if event == 'workflow_dispatch':
        result['publish'] = dispatch is True
        return result
    if event != 'push' or not COMMIT.fullmatch(before) or before == '0' * 40:
        return result
    subprocess.run(['git', 'merge-base', '--is-ancestor', before, commit], cwd=root, check=True, capture_output=True)
    changed = subprocess.run(['git', 'diff', '--quiet', before, commit, '--', REQUEST], cwd=root, capture_output=True)
    if changed.returncode == 0:
        return result
    if changed.returncode != 1:
        raise ValueError('Release request change could not be established.')
    path = root / REQUEST
    if not path.is_file():
        return result
    if path.stat().st_size > 4096:
        raise ValueError('Release request is too large.')
    request = strict_json(path.read_text(encoding='utf-8'))
    if not isinstance(request, dict) or set(request) != {'version', 'publish', 'request_id'}:
        raise ValueError('Release request requires exactly version, publish and request_id.')
    if request['version'] != version or type(request['publish']) is not bool:
        raise ValueError('Release request version or publish choice is invalid.')
    if not isinstance(request['request_id'], str) or str(uuid.UUID(request['request_id'])) != request['request_id']:
        raise ValueError('Use a new canonical UUID for each release request.')
    result['publish'] = request['publish']
    return result


def main():
    root = Path(__file__).resolve().parents[1]
    result = plan(root, os.environ.get('RELEASE_EVENT', ''), os.environ.get('RELEASE_REF', ''),
                  os.environ.get('GITHUB_REPOSITORY', ''), os.environ.get('GITHUB_SHA', ''),
                  os.environ.get('RELEASE_BEFORE', ''), os.environ.get('RELEASE_DISPATCH') == 'true')
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
        for key, value in result.items():
            output.write(f'{key}={str(value).lower() if type(value) is bool else value}\n')
    print(f"Version {result['version']}: {'publication requested' if result['publish'] else 'build and verification only'}.")


if __name__ == '__main__':
    main()
