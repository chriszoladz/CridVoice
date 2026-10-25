# Models and hardware

## Processing stages

Speech recognition and text cleanup are separate. Speech uses faster-whisper / CTranslate2; cleanup uses a managed llama.cpp server or the selected external provider. Audio recognition does not become available merely because a text LLM is loaded in LM Studio.

| Component | Default | Hardware |
| --- | --- | --- |
| Speech | Whisper Large v3 Turbo | NVIDIA CUDA or CPU |
| Lighter speech | Whisper Small | NVIDIA CUDA or CPU |
| Live preview | Whisper Tiny, separate from final speech | Low-priority CPU, two threads |
| Text cleanup | Qwen3 4B Q4_K_M | llama.cpp Vulkan GPU or CPU |
| GPU speech runtime | cuBLAS 12.9.2.10 + cuDNN 9.27.0.42 | NVIDIA driver required |
| Text runtime | llama.cpp b11559 | CPU or Vulkan |

The exact URLs, sizes, and SHA-256 hashes are in `src-tauri/resources/model-catalog.json`. Speech model revisions and GGUF revisions are pinned. GPU speech libraries are downloaded only when selected. Python and Python inference dependencies are already packaged.

## RTX 5070 Ti

Use a current NVIDIA Windows driver. Install the NVIDIA speech runtime for CUDA recognition; having an NVIDIA card without its speech libraries is insufficient. The runtime uses CUDA 12.9 libraries, supporting the RTX 50-series architecture. The text engine uses Vulkan to avoid a separate CUDA-version dependency for llama.cpp.

Select Automatic to prefer detected NVIDIA hardware, GPU to require it, or CPU to avoid it. CridVoice uses `nvidia-smi` to detect NVIDIA cards and memory. Detection is not a successful inference test. If detection fails, Automatic chooses CPU. If GPU inference fails, the app reports it; it does not silently send data to cloud or switch providers.

## Intel and AMD CPUs

Select CPU for both engines. Speech uses int8 compute; GPU speech uses int8/float16. CPU threads are capped at 16 in the speech worker. Whisper Small provides a lighter multilingual option; larger models can be slow on CPU. CPU text inference uses zero GPU layers. The runtime chooses its compatible CPU backend from the shipped llama.cpp distribution.

## Memory and latency

The Models page separates your **Selected** configuration, **Installed** files on disk, and **Models in memory**. Live local engine status identifies the actual resident final speech, CPU preview, or cleanup model and device as unloaded, loading, loaded, or error. In 0.1.4, installed selected local engines warm automatically in the background after launch. A selected or installed model is not ready merely because its files are on disk. Overview shows warming while preparation runs, and a silent take can still complete without loading speech weights.

Model changes update every app window through events. A backend check every two seconds also detects exited inference children and changed installed markers. The page refreshes automatically without reloading or restarting CridVoice. External LM Studio, llama.cpp, or cloud model residency remains under that provider's control; CridVoice reports its own managed engines.

Keep VRAM free for both models. Both engines can remain loaded between takes to reduce latency. LM Studio, games, and other GPU work can compete for memory. Use **Unload models from memory** when idle to release workers and their allocations, or choose CPU for one stage. Explicit unload cancels pending warming and keeps the engines unloaded; use the manual loading action or dictate again when ready. Cold loading still takes time just after launch or unloading. Background warm-up moves that work ahead of the first take where possible; it does not remove hardware initialization costs.

Local live preview uses a separate Whisper Tiny CPU worker with two threads and low process priority. Its pinned download is 78,203,619 bytes, about 75 MiB. It processes only the latest six seconds and produces revisable chunks rather than true per-word callbacks. The selected final model keeps its separate worker, device, warm state, and full-audio recognition settings. This isolates its worker lock and GPU allocations from preview, while shared CPU/system resources can still affect timings. Turn preview off for the lightest CPU workflow.

The independent local preview skips a busy worker instead of queueing and has a five-second request budget; preview warming allows thirty seconds. Final speech queue/processing limits remain 60/240 seconds. Managed cleanup startup allows 120 seconds and chat requests allow 180 seconds. These are separate stage budgets. A failure reports an error without switching to cloud or another provider.

On the Windows validation machine, original and updated packaged workers both recognized a short synthetic English fixture using Whisper Turbo on CPU and RTX 5070 Ti CUDA. The updated worker also reported its loaded model/device and cleared that status on unload. This establishes a narrow worker smoke pass, not real microphone quality, Polish accuracy, or complete desktop behavior. See [the dated Windows report](WINDOWS-VALIDATION-2026-10-13.md).

Cleanup requests cap output at 4,096 tokens. Truncated model responses are rejected; the recognized transcript is preserved instead of silently inserting an incomplete edit. A model's context/output limits can require shorter takes, especially with large selected text or long recordings.

## Download lifecycle

The setup wizard derives the complete local component plan from both selected stages and devices. Local speech needs its final speech model plus NVIDIA runtime when using CUDA. Enabled local live preview additionally requires the separate Whisper Tiny asset; disabled preview or provider speech does not. Tiny appears in its own Live preview group and cannot be selected as the final speech model. Managed cleanup needs Qwen3 plus the selected CPU/Vulkan engine. Automatic prefers detected NVIDIA hardware; explicit Vulkan cleanup GPU is not limited to NVIDIA. Provider-based stages and disabled cleanup omit their local requirements.

The final wizard step names every required component and shows the missing download total. **Install required components & finish** automatically installs missing components sequentially, skips already-installed assets, and keeps visible overall/per-component download and verification/extraction progress. **Pause setup**, **Resume setup**, and **Retry setup** preserve usable partials and installed components. Completion requires a fresh installed-state snapshot and a native readiness check; an unfinished local plan cannot be saved as completed setup.

If an existing app lacks selected components, use the repair wizard instead of manually downloading files outside CridVoice. Fully provider-based routes require no local downloads. A browser preview cannot establish local installed readiness.

Downloads stream to `.part` files in the model directory, support valid HTTP byte ranges on retry, verify expected size and SHA-256, then rename atomically. Runtime ZIP/wheel contents are extracted with path and symbolic-link checks. A model is marked installed only after every file is verified and extraction completes.

Pause retains partial data for resume. A network interruption also retains partial data. A hash mismatch removes the corrupt partial file. Removing a model unloads engines before deleting its directory. Removal/unloading is rejected while dictation is active.

Shown sizes are compressed download totals. Keep additional disk space for extracted runtimes, temporary files, and models. NVIDIA libraries in particular can occupy substantially more than their download size. All model downloads are explicit; completed models can run offline.

## Maintaining the catalog

`python scripts/update_catalog.py` is a maintainer operation requiring network access. It refreshes metadata at already pinned revisions and releases. Review the generated URLs, licensing, file sizes, and hashes before committing any source or version change. An ordinary app session never resolves a floating “latest” model or executes remote code from a model repository.
