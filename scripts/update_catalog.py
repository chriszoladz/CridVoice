"""Maintainer-only: refresh the pinned, SHA-256 verified download catalog."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
def read_json(url):
    with urllib.request.urlopen(url, timeout=45) as r:
        return json.load(r)
def hf_model(repo, revision, names):
    tree = read_json(f'https://huggingface.co/api/models/{repo}/tree/{revision}?expand=true')
    files = []
    for entry in tree:
        if entry['path'] not in names:
            continue
        url = f"https://huggingface.co/{repo}/resolve/{revision}/{entry['path']}"
        sha = entry.get('lfs', {}).get('oid')
        if not sha:
            with urllib.request.urlopen(url, timeout=45) as r:
                sha = hashlib.sha256(r.read()).hexdigest()
        files.append({'name':entry['path'], 'url':url, 'sha256':sha, 'bytes':entry['size']})
    assert set(names) == {f['name'] for f in files}
    return files
def model(id, name, kind, description, license, files):
    return dict(id=id,name=name,kind=kind,description=description,license=license,files=files,sizeBytes=sum(f['bytes'] for f in files),installed=False)
def main():
    catalog = [
        model('whisper-turbo','Whisper Large v3 Turbo','speech','Best balance for your NVIDIA GPU. Multilingual English and Polish.','MIT',hf_model('mobiuslabsgmbh/faster-whisper-large-v3-turbo','0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf',['config.json','model.bin','preprocessor_config.json','tokenizer.json','vocabulary.json'])),
        model('whisper-small','Whisper Small','speech','Smaller multilingual model for Intel and AMD CPUs.','MIT',hf_model('Systran/faster-whisper-small','536b0662742c02347bc0e980a01041f333bce120',['config.json','model.bin','tokenizer.json','vocabulary.txt'])),
        model('qwen3-4b','Qwen3 4B · Q4_K_M','cleanup','Compact local editing model. Resolves corrections while preserving meaning.','Apache-2.0',hf_model('Qwen/Qwen3-4B-GGUF','bc640142c66e1fdd12af0bd68f40445458f3869b',['Qwen3-4B-Q4_K_M.gguf']))
    ]
    release=read_json('https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/b11559')
    for id,label,needle in [('llama-cpu','llama.cpp · CPU','llama-b11559-bin-win-cpu-x64.zip'),('llama-gpu','llama.cpp · NVIDIA GPU','llama-b11559-bin-win-vulkan-x64.zip')]:
        asset=next(a for a in release['assets'] if a['name']==needle)
        catalog.append(model(id,label,'runtime','App-managed local language-model engine. GPU engine uses Vulkan.','MIT',[dict(name=asset['name'],url=asset['browser_download_url'],sha256=asset['digest'].split(':')[1],bytes=asset['size'])]))
    libs=[]
    for package,version in [('nvidia-cublas-cu12','12.9.2.10'),('nvidia-cudnn-cu12','9.27.0.42')]:
        d=read_json(f'https://pypi.org/pypi/{package}/{version}/json')
        asset=next(a for a in d['urls'] if 'win_amd64' in a['filename'])
        libs.append(dict(name=asset['filename'],url=asset['url'],sha256=asset['digests']['sha256'],bytes=asset['size']))
    catalog.append(model('nvidia-runtime','NVIDIA speech runtime','runtime','cuBLAS 12.9 and cuDNN 9 libraries for GPU speech recognition, including RTX 50 series. CPU does not need this.','NVIDIA redistributable EULA',libs))
    path=ROOT/'src-tauri/resources/model-catalog.json'
    path.write_text(json.dumps(catalog,indent=2)+'\n',encoding='utf-8')
    print('Pinned '+str(len(catalog))+' models/runtimes with SHA-256 verification.')
if __name__ == '__main__':
    main()
