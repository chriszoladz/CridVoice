"""Publish verified assets with the job-scoped GitHub credential, never a browser."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

from release_assets import INFO, SUMS, names, sha, verify
from release_plan import REPOSITORY

PREFIX = f'repos/{REPOSITORY}/'


class GitHub:
    def api(self, path, method='GET', body=None, optional=False):
        if not path.startswith(PREFIX):
            raise ValueError('GitHub access is restricted to the CridVoice repository.')
        command = ['gh', 'api', '--hostname', 'github.com', '--method', method, path]
        if body is not None:
            command += ['--input', '-']
        result = subprocess.run(command, input=None if body is None else json.dumps(body),
                                capture_output=True, text=True, timeout=120)
        if result.returncode:
            if optional and '(HTTP 404)' in result.stderr:
                return None
            raise RuntimeError('GitHub release request failed; raw response and credentials are not logged.')
        return json.loads(result.stdout)

    def upload(self, tag, files):
        result = subprocess.run(['gh', 'release', 'upload', tag, *map(str, files),
                                 '--repo', f'https://github.com/{REPOSITORY}'],
                                capture_output=True, timeout=300)
        if result.returncode:
            raise RuntimeError('Release upload failed. Retry the failed publish job to resume this matching draft.')

    def download(self, asset_id, destination):
        if type(asset_id) is not int or asset_id <= 0:
            raise ValueError('Invalid release asset identity.')
        with destination.open('wb') as output:
            result = subprocess.run(['gh', 'api', '--hostname', 'github.com',
                                     PREFIX + f'releases/assets/{asset_id}', '-H', 'Accept: application/octet-stream'],
                                    stdout=output, stderr=subprocess.PIPE, timeout=300)
        if result.returncode:
            raise RuntimeError('Uploaded release asset could not be downloaded for verification.')


def tag_commit(client, tag):
    ref = client.api(PREFIX + f'git/ref/tags/{tag}', optional=True)
    if ref is None:
        return None
    obj = ref['object']
    for _ in range(4):
        if obj['type'] == 'commit':
            return obj['sha']
        if obj['type'] != 'tag':
            break
        obj = client.api(PREFIX + f"git/tags/{obj['sha']}")['object']
    raise ValueError('Release tag does not identify a commit.')


def managed_release(client, release_id, marker, version, commit):
    release = client.api(PREFIX + f'releases/{release_id}')
    if release['tag_name'] != 'v' + version or marker not in (release.get('body') or ''):
        raise ValueError('Existing release is not this exact managed artifact set; it has been preserved.')
    if release['draft'] and release['target_commitish'] != commit:
        raise ValueError('Existing draft targets another source; it has been preserved.')
    return release


def verify_uploaded(client, release, folder, expected):
    assets = release['assets']
    if len(assets) != len(expected) or {asset['name'] for asset in assets} != expected:
        raise ValueError('Uploaded release asset set differs; publication stopped.')
    with tempfile.TemporaryDirectory(prefix='cridvoice-upload-check-') as temporary:
        for asset in assets:
            local = folder / asset['name']
            if asset['size'] != local.stat().st_size:
                raise ValueError('Uploaded release asset size differs.')
            downloaded = Path(temporary) / asset['name']
            client.download(asset['id'], downloaded)
            if sha(downloaded) != sha(local):
                raise ValueError('Uploaded release checksum differs; publication stopped.')


def publish(client, folder, version, commit):
    folder = folder.resolve()
    verify(folder, version, commit)
    tag = 'v' + version
    target = tag_commit(client, tag)
    if target is not None and target != commit:
        raise ValueError('Existing version tag targets another commit; it has been preserved.')
    expected = {*names(version), INFO, SUMS}
    marker = f'<!-- cridvoice-release-v1 source={commit} manifest={sha(folder / INFO)} -->'
    existing = client.api(PREFIX + f'releases/tags/{tag}', optional=True)
    if existing is None:
        notes = (f'## CridVoice {version}\n\nUnsigned Windows 11 x64 evaluation build.\n\n'
                 'Download the setup EXE for installation, or extract the entire portable ZIP to a writable folder. '
                 'The installer ZIP contains the same setup EXE. First-run setup downloads selected models with progress.\n\n'
                 f'Source: `{commit}`. SHA-256 checksums and BUILD-INFO.json are attached.\n\n{marker}')
        existing = client.api(PREFIX + 'releases', 'POST', {'tag_name': tag, 'target_commitish': commit,
                              'name': f'CridVoice {version}', 'body': notes, 'draft': True,
                              'prerelease': True, 'make_latest': 'false'})
    release_id = existing['id']
    current = managed_release(client, release_id, marker, version, commit)
    if not current['draft']:
        if target != commit or not current['prerelease']:
            raise ValueError('Published release identity differs; nothing was overwritten.')
        verify_uploaded(client, current, folder, expected)
        return f'https://github.com/{REPOSITORY}/releases/tag/{tag}'
    present = {asset['name'] for asset in current['assets']}
    if len(present) != len(current['assets']) or not present <= expected:
        raise ValueError('Draft contains unexpected assets; they have been preserved.')
    # Existing assets must already match. Never clobber even a partial draft.
    if present:
        verify_uploaded(client, current, folder, present)
    missing = sorted(expected - present)
    if missing:
        current = managed_release(client, release_id, marker, version, commit)
        if not current['draft']:
            raise ValueError('Draft changed before upload; nothing was overwritten.')
        client.upload(tag, [folder / name for name in missing])
    current = managed_release(client, release_id, marker, version, commit)
    verify_uploaded(client, current, folder, expected)
    current = managed_release(client, release_id, marker, version, commit)
    if not current['draft']:
        raise ValueError('Draft changed before publication.')
    current_target = tag_commit(client, tag)
    if current_target is not None and current_target != commit:
        raise ValueError('Version tag changed before publication; draft preserved.')
    client.api(PREFIX + f'releases/{release_id}', 'PATCH', {'draft': False, 'prerelease': True, 'make_latest': 'false'})
    final = managed_release(client, release_id, marker, version, commit)
    if final['draft'] or not final['prerelease'] or tag_commit(client, tag) != commit:
        raise ValueError('Published release identity could not be verified.')
    verify_uploaded(client, final, folder, expected)
    return f'https://github.com/{REPOSITORY}/releases/tag/{tag}'


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--folder', type=Path, required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--commit', required=True)
    args = parser.parse_args()
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('GITHUB_REPOSITORY') != REPOSITORY or not os.environ.get('GH_TOKEN'):
        raise SystemExit('Publication requires the repository-scoped GitHub Actions job credential.')
    print(publish(GitHub(), args.folder, args.version, args.commit))
