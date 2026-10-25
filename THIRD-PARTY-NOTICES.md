# Third-party notices

CridVoice includes or uses third-party software. Preserve upstream notices distributed with Python wheels, runtime archives, and model repositories. This document is a navigation aid, not a replacement for those licenses.

| Component | License/source |
| --- | --- |
| Tauri, React, Vite, TypeScript, Lucide | Upstream MIT/Apache licenses; npm/Rust lockfiles identify exact versions |
| CPython embedded interpreter | Python Software Foundation license; included runtime license |
| App-local Microsoft Visual C++ runtime | Microsoft runtime terms; pinned Microsoft VCLibs desktop package identified in python-windows.lock.json |
| faster-whisper | MIT, SYSTRAN/faster-whisper |
| CTranslate2 | MIT, OpenNMT/CTranslate2 |
| NumPy | BSD-3-Clause; bundled wheel notices |
| ONNX Runtime | MIT; bundled wheel notices |
| PyAV / bundled FFmpeg libraries | PyAV BSD-3-Clause; FFmpeg library licensing/notices in wheel distribution |
| Hugging Face/tokenizers and dependent wheels | Respective upstream licenses in bundled dist-info |
| Whisper model weights | MIT, OpenAI Whisper and pinned faster-whisper conversions |
| Qwen3 4B GGUF | Apache-2.0, Qwen/Qwen3-4B-GGUF |
| llama.cpp | MIT, ggml-org/llama.cpp |
| NVIDIA cuBLAS / cuDNN | NVIDIA redistributable EULAs/licenses, preserved in downloaded wheels |
| SQLite | Public domain |
| WebView2 runtime | Microsoft runtime terms; installed/system-managed separately |

Models and NVIDIA libraries are optional downloads, not application-authored code. Their download sizes, versions, and hashes are pinned in the model catalog. Public redistribution should review each included component and its notices, including runtime/model license changes.
