"""Create a portable ZIP with the same runtime and resources as the installer."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import zipfile
ROOT=Path(__file__).resolve().parents[1]

def remove_generated_output(path):
    root=(ROOT/'release').resolve()
    if not path.resolve().is_relative_to(root):raise SystemExit('Portable output must stay within the release directory.')
    if (path/'data').exists():raise SystemExit('The portable output folder contains user data. Move or back it up before rebuilding; it has not been changed.')
    def writable_retry(operation,filename,error):
        if not isinstance(error,PermissionError) or not Path(filename).resolve().is_relative_to(path.resolve()):raise error
        os.chmod(filename,stat.S_IRUSR|stat.S_IWUSR|stat.S_IXUSR)
        operation(filename)
    shutil.rmtree(path,onexc=writable_retry)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--target',default='x86_64-pc-windows-msvc');args=parser.parse_args()
    target=ROOT/'src-tauri/target'/args.target/'release'
    if not target.exists():target=ROOT/'src-tauri/target/release'
    binary=target/'cridvoice.exe'
    if not binary.exists():raise SystemExit('Build the Windows executable before packaging portable.')
    version=json.loads((ROOT/'package.json').read_text())['version'];output=ROOT/'release';output.mkdir(exist_ok=True);dest=output/f'CridVoice-{version}-portable'
    if not dest.resolve().is_relative_to(output.resolve()):raise SystemExit('Portable output must stay within the release directory.')
    if (dest/'data').exists():raise SystemExit('The portable output folder contains user data. Move or back it up before rebuilding; it has not been changed.')
    if dest.exists():remove_generated_output(dest)
    dest.mkdir();shutil.copy2(binary,dest/'CridVoice.exe')
    resource=ROOT/'src-tauri/resources'
    for name in ['python','service','help']:shutil.copytree(resource/name,dest/name,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    shutil.copy2(resource/'model-catalog.json',dest/'model-catalog.json')
    (dest/'portable.flag').write_text('CridVoice portable mode. Data is stored in ./data.\n')
    (dest/'START-HERE.txt').write_text('CridVoice\n\nExtract this entire folder to a writable location, then run CridVoice.exe.\nKeep python/, service/, and model-catalog.json alongside the executable.\nSettings, models, and history stay in data/. API keys stay in Windows Credential Manager.\nMicrosoft WebView2 is normally included with Windows 11.\nIf missing, install it from https://developer.microsoft.com/microsoft-edge/webview2/\n\nDocumentation is in docs/. Start with README.md.\n\nThis personal preview build is unsigned and requires Windows validation.\n')
    shutil.copytree(ROOT/'docs',dest/'docs');shutil.copy2(ROOT/'README.md',dest/'README.md');shutil.copy2(ROOT/'THIRD-PARTY-NOTICES.md',dest/'THIRD-PARTY-NOTICES.md')
    archive=output/f'CridVoice-{version}-windows-x64-portable.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for file in sorted(dest.rglob('*')):
            if file.is_file():z.write(file,file.relative_to(output))
    with archive.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
    print(str(archive));print('SHA256 '+digest)
if __name__=='__main__':main()
