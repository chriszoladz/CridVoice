"""Package and verify the exact public Windows release asset set."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import struct
import zipfile

from release_plan import COMMIT, VERSION, read_version, strict_json

INFO = 'BUILD-INFO.json'
SUMS = 'SHA256SUMS.txt'


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def archive_sha(archive, name):
    with archive.open(name) as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def names(version):
    if not isinstance(version, str) or not VERSION.fullmatch(version) or len(version) > 64:
        raise ValueError('Invalid release version.')
    return [f'CridVoice-{version}-windows-x64-setup.exe',
            f'CridVoice-{version}-windows-x64-installer.zip',
            f'CridVoice-{version}-windows-x64-portable.zip']


def pe_machine(data):
    if len(data) < 64 or data[:2] != b'MZ':
        raise ValueError('A Windows executable is required.')
    offset = struct.unpack_from('<I', data, 60)[0]
    if offset > len(data) - 6 or data[offset:offset + 4] != b'PE\0\0':
        raise ValueError('Invalid Windows executable header.')
    return struct.unpack_from('<H', data, offset + 4)[0]


def archive_files(archive):
    result = {}
    for entry in archive.infolist():
        path = PurePosixPath(entry.filename)
        if '\\' in entry.filename or path.is_absolute() or any(part in {'', '.', '..'} for part in entry.filename.rstrip('/').split('/')) or ':' in entry.filename or stat.S_ISLNK(entry.external_attr >> 16):
            raise ValueError('Unsafe archive path or link.')
        if entry.is_dir():
            continue
        if entry.filename.casefold() in result:
            raise ValueError('Duplicate archive path.')
        result[entry.filename.casefold()] = entry.filename
    if archive.testzip() is not None:
        raise ValueError('Archive integrity check failed.')
    return set(result.values())


def check_portable(path, version, app_hash, expected=None):
    prefix = f'CridVoice-{version}-portable/'
    with zipfile.ZipFile(path) as archive:
        entries = archive_files(archive)
        if any(not name.startswith(prefix) for name in entries):
            raise ValueError('Portable files must share one versioned folder.')
        relative = {name[len(prefix):] for name in entries}
        required = {'CridVoice.exe', 'portable.flag', 'START-HERE.txt', 'README.md', 'THIRD-PARTY-NOTICES.md',
                    'model-catalog.json', 'python/python.exe', 'service/speech.py', 'help/index.html'}
        if not required <= relative or not any(name.startswith('docs/') for name in relative):
            raise ValueError('Portable build is incomplete.')
        if any(name.split('/')[0].lower() in {'data', 'recordings', 'models', '.git'} or
               name.lower() in {'settings.json', 'history.sqlite3', '.env', 'credentials.json'} for name in relative):
            raise ValueError('Portable build contains forbidden app data.')
        app = archive.read(prefix + 'CridVoice.exe')
        if pe_machine(app) != 0x8664 or hashlib.sha256(app).hexdigest() != app_hash:
            raise ValueError('Portable executable does not match its verified build.')
        if expected is not None:
            if relative != set(expected):
                raise ValueError('Unexpected portable resources or missing files.')
            for name, wanted in expected.items():
                if archive_sha(archive, prefix + name) != wanted:
                    raise ValueError('Portable resource differs from its build input.')
        return len(relative)


def prepare(root, output, commit):
    version = read_version(root)
    if not COMMIT.fullmatch(commit):
        raise ValueError('Invalid source commit.')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Preserve existing output; choose an empty publishing folder.')
    target = root / 'src-tauri/target/x86_64-pc-windows-msvc/release'
    app = target / 'cridvoice.exe'
    setup = target / f'bundle/nsis/CridVoice_{version}_x64-setup.exe'
    portable = root / f'release/CridVoice-{version}-windows-x64-portable.zip'
    if pe_machine(app.read_bytes()) != 0x8664 or pe_machine(setup.read_bytes()) not in {0x14c, 0x8664}:
        raise ValueError('Unexpected executable architecture.')
    staged = root / f'release/CridVoice-{version}-portable'
    expected = {}
    for name in ['python', 'service', 'help']:
        for path in (root / 'src-tauri/resources' / name).rglob('*'):
            if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc':
                expected[f'{name}/{path.relative_to(root / "src-tauri/resources" / name).as_posix()}'] = sha(path)
    for path in (root / 'docs').rglob('*'):
        if path.is_file():
            expected[f'docs/{path.relative_to(root / "docs").as_posix()}'] = sha(path)
    for name in ['README.md', 'THIRD-PARTY-NOTICES.md']:
        expected[name] = sha(root / name)
    expected['model-catalog.json'] = sha(root / 'src-tauri/resources/model-catalog.json')
    expected['CridVoice.exe'] = sha(app)
    for name in ['portable.flag', 'START-HERE.txt']:
        expected[name] = sha(staged / name)
    check_portable(portable, version, sha(app), expected)
    output.mkdir(parents=True, exist_ok=True)
    setup_name, installer_name, portable_name = names(version)
    shutil.copy2(setup, output / setup_name)
    shutil.copy2(portable, output / portable_name)
    with zipfile.ZipFile(output / installer_name, 'x', zipfile.ZIP_DEFLATED) as archive:
        archive.write(setup, setup_name)
        archive.write(root / 'THIRD-PARTY-NOTICES.md', 'THIRD-PARTY-NOTICES.md')
        archive.writestr('START-HERE.txt', f'CridVoice {version}\nExtract this ZIP and run {setup_name}.\nFirst-run setup downloads selected models with progress.\nUnsigned evaluation build.\n')
    info = {'schema': 1, 'version': version, 'commit': commit, 'platform': 'windows-x64',
            'unsigned': True, 'prerelease': True, 'portableResourcesVerified': True,
            'portableExecutableSha256': sha(app), 'portableFiles': len(expected),
            'artifacts': {name: sha(output / name) for name in names(version)}}
    (output / INFO).write_text(json.dumps(info, indent=2) + '\n', encoding='utf-8')
    (output / SUMS).write_text(''.join(f'{sha(output / name)}  {name}\n' for name in [*names(version), INFO]), encoding='utf-8')
    verify(output, version, commit)
    print(f'Prepared and verified five public release files for {version}.')


def verify(folder, version, commit):
    expected_names = {*names(version), INFO, SUMS}
    if not COMMIT.fullmatch(commit) or {path.name for path in folder.iterdir()} != expected_names or any(not p.is_file() or p.is_symlink() for p in folder.iterdir()):
        raise ValueError('Release asset set or source identity is invalid.')
    if (folder / INFO).stat().st_size > 16384 or (folder / SUMS).stat().st_size > 4096:
        raise ValueError('Release metadata is too large.')
    info = strict_json((folder / INFO).read_text(encoding='utf-8'))
    if set(info) != {'schema', 'version', 'commit', 'platform', 'unsigned', 'prerelease', 'portableResourcesVerified', 'portableExecutableSha256', 'portableFiles', 'artifacts'}:
        raise ValueError('Unknown release metadata fields.')
    if info['schema'] != 1 or info['version'] != version or info['commit'] != commit or info['platform'] != 'windows-x64' or any(info[key] is not True for key in ['unsigned', 'prerelease', 'portableResourcesVerified']):
        raise ValueError('Release metadata does not match this verified evaluation build.')
    expected_hashes = {name: sha(folder / name) for name in names(version)}
    if info['artifacts'] != expected_hashes:
        raise ValueError('Release payload checksums changed.')
    expected_sums = ''.join(f'{sha(folder / name)}  {name}\n' for name in [*names(version), INFO])
    if (folder / SUMS).read_text(encoding='utf-8') != expected_sums:
        raise ValueError('Checksum manifest changed.')
    setup_name, installer_name, portable_name = names(version)
    if pe_machine((folder / setup_name).read_bytes()) not in {0x14c, 0x8664}:
        raise ValueError('Installer is not a Windows executable.')
    with zipfile.ZipFile(folder / installer_name) as archive:
        if archive_files(archive) != {setup_name, 'THIRD-PARTY-NOTICES.md', 'START-HERE.txt'} or archive_sha(archive, setup_name) != expected_hashes[setup_name]:
            raise ValueError('Installer ZIP does not match the setup executable.')
    if type(info['portableFiles']) is not int or check_portable(folder / portable_name, version, info['portableExecutableSha256']) != info['portableFiles']:
        raise ValueError('Portable file count differs from its verified build.')
    return info


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['prepare', 'verify'])
    parser.add_argument('--folder', type=Path, required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--version')
    args = parser.parse_args()
    if args.operation == 'prepare':
        prepare(Path(__file__).resolve().parents[1], args.folder, args.commit)
    else:
        verify(args.folder, args.version, args.commit)
        print('Release asset integrity and source identity verified.')
