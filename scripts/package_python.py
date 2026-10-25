"""Package a Windows Python interpreter and locked Windows wheels without requiring Python on users' PCs."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT=Path(__file__).resolve().parents[1]
RESOURCE=ROOT/'src-tauri/resources'
PYTHON_URL='https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip'
MSVC={
    'url':'https://download.microsoft.com/download/4/7/c/47c6134b-d61f-4024-83bd-b9c9ea951c25/Microsoft.VCLibs.x64.14.00.Desktop.appx',
    'sha256':'b56a9101f706f9d95f815f5b7fa6efbac972e86573d378b96a07cff5540c5961',
    'files':['msvcp140.dll','msvcp140_1.dll','msvcp140_2.dll','msvcp140_atomic_wait.dll','msvcp140_codecvt_ids.dll','concrt140.dll'],
}
def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f,'sha256').hexdigest()
def extract(archive,dest):
    with zipfile.ZipFile(archive) as z:
        for member in z.infolist():
            target=(dest/member.filename).resolve()
            if not target.is_relative_to(dest.resolve()) or member.external_attr>>16&0o170000==0o120000:
                raise ValueError('Unsafe archive entry: '+member.filename)
        z.extractall(dest)
def main():
    p=argparse.ArgumentParser();p.add_argument('--locked',action='store_true');args=p.parse_args()
    dest=RESOURCE/'python';wheels=RESOURCE/'wheels';dest.mkdir(parents=True,exist_ok=True);wheels.mkdir(parents=True,exist_ok=True)
    archive=wheels/'python-3.12.10-embed-amd64.zip'
    if not archive.exists():
        print('Downloading embedded Windows Python',flush=True)
        with urllib.request.urlopen(PYTHON_URL,timeout=60) as r,archive.open('wb') as out:
            shutil.copyfileobj(r,out)
    lockpath=ROOT/'python-windows.lock.json'
    lock=json.loads(lockpath.read_text()) if lockpath.exists() else None
    if args.locked and lock is None:raise SystemExit('A committed Windows dependency lock is required.')
    if lock and digest(archive)!=lock['python']['sha256']:raise SystemExit('Embedded Python checksum mismatch.')
    if args.locked and 'msvc' not in lock:raise SystemExit('The dependency lock must include the app-local C++ runtime.')
    if dest.exists():shutil.rmtree(dest)
    dest.mkdir(parents=True)
    extract(archive,dest)
    runtime=lock['msvc'] if lock else MSVC
    runtime_archive=wheels/'Microsoft.VCLibs.x64.14.00.Desktop.appx'
    if not runtime_archive.exists():
        print('Downloading app-local Microsoft C++ runtime',flush=True)
        with urllib.request.urlopen(runtime['url'],timeout=60) as r,runtime_archive.open('wb') as out:shutil.copyfileobj(r,out)
    if digest(runtime_archive)!=runtime['sha256']:raise SystemExit('C++ runtime checksum mismatch.')
    with zipfile.ZipFile(runtime_archive) as z:
        for name in runtime['files']:
            if Path(name).name!=name or not name.lower().endswith('.dll'):raise SystemExit('Invalid C++ runtime entry.')
            (dest/name).write_bytes(z.read(name))
    if lock:
        for entry in lock['wheels']:
            target=wheels/entry['filename']
            if not target.exists():
                print('Downloading '+entry['filename'],flush=True)
                with urllib.request.urlopen(entry['url'],timeout=120) as r,target.open('wb') as out:shutil.copyfileobj(r,out)
            if digest(target)!=entry['sha256']:raise SystemExit('Wheel checksum mismatch: '+entry['filename'])
    else:
        subprocess.run([sys.executable,'-m','pip','download','--dest',str(wheels),'--platform','win_amd64','--python-version','312','--implementation','cp','--abi','cp312','--only-binary=:all:','-r',str(ROOT/'requirements-speech.txt')],check=True)
    entries=[];site=dest/'Lib/site-packages';site.mkdir(parents=True,exist_ok=True)
    for wheel in sorted(wheels.glob('*.whl')):
        if lock and wheel.name not in {e['filename'] for e in lock['wheels']}:continue
        extract(wheel,site)
        if not lock:
            # Recover immutable PyPI URLs and hashes for the resolved wheels.
            name,version=wheel.name.split('-')[:2]
            with urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{version}/json',timeout=45) as r:metadata=json.load(r)
            asset=next(a for a in metadata['urls'] if a['filename']==wheel.name)
            actual=digest(wheel)
            if actual!=asset['digests']['sha256']:raise SystemExit('PyPI checksum mismatch: '+wheel.name)
            entries.append(dict(filename=wheel.name,url=asset['url'],sha256=actual))
    (dest/'python312._pth').write_text('python312.zip\n.\nLib\\site-packages\nimport site\n')
    if not lock:
        lockpath.write_text(json.dumps({'python':{'url':PYTHON_URL,'sha256':digest(archive)},'msvc':runtime,'wheels':entries},indent=2)+'\n')
    print('Packaged Python and '+str(len(list(site.glob('*.dist-info'))))+' Windows dependencies.',flush=True)
if __name__=='__main__':main()
