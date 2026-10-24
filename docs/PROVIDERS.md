# Providers

## Independent routing

In Providers, create a connection. In Settings, select it for text cleanup and/or audio recognition. A provider being listed does not activate it. Local is the initial default. Errors never cause automatic cloud fallback.

| Protocol | Text endpoint | Audio endpoint |
| --- | --- | --- |
| OpenAI compatible | `<base>/chat/completions` | `<base>/audio/transcriptions`, when supported |
| Anthropic compatible | `<base>/messages` | Not used; choose local or an OpenAI-compatible speech provider |

Provide the API root, normally ending in `/v1`, not an individual request URL. A bare origin gets `/v1` appended. Custom paths are retained; a trailing slash is normalized. Remote endpoints require HTTPS. HTTP is permitted only for localhost/loopback. Credentials in the URL, fragments, and query strings are rejected.

## Choose model IDs

In setup or the provider editor, configure the endpoint/protocol and choose **Fetch models**. This explicitly sends a model-list GET request to that draft endpoint; opening the editor does not contact it. Select returned IDs for text and, for OpenAI-compatible speech, audio. A listing does not classify capabilities or prove account access. Use **Enter a custom model ID** for an unlisted model or a server without discovery; **Not selected** clears an optional speech choice.

Discovery sends no dictation or application context and runs no model. Typed draft keys are not saved by Fetch. A saved key is read only when the provider ID, protocol, and base URL match the current saved connection exactly; otherwise supply a typed key or use an unauthenticated server. Requests do not follow redirects and have bounded time, response size, and model count. The picker preserves current selections and ignores stale replies after endpoint/key changes. Endpoint presets do not establish model/account availability.

## LM Studio

1. Load an instruction-following model in LM Studio.
2. Start its local server and check the port.
3. Add the LM Studio preset (`http://127.0.0.1:1234/v1`). Use **Fetch models**, or the custom fallback with the **exact model ID** shown by the server; discovery availability varies by server version.
4. Save and use **Test**. The test sends a short “READY” request, not your dictation or application context.
5. In Settings, select **Selected provider** under **Text cleanup** and choose that connection.
6. Keep local speech selected and download a speech model/runtime, unless you separately selected a compatible audio API.

LM Studio remains independently managed. CridVoice does not start/stop its process or change its loaded models.

## llama.cpp

Start your own `llama-server` with a compatible GGUF and listen on loopback. The preset is `http://127.0.0.1:8080/v1`. Enter the server's model ID, plus its API key if enabled. Select it for cleanup. The **managed local** mode is separate: CridVoice launches its own bundled/downloaded engine, chooses a free loopback port, and creates a per-session API key.

## OpenAI and compatible cloud APIs

Use the OpenAI preset or a custom base URL, an API key, and the exact text model ID. For cloud speech, also set a supported speech model ID and select that provider under Speech recognition. Standard audio requests use multipart WAV uploads and JSON responses. Compatible providers must actually implement the chosen endpoint and model.

Text requests send system/user messages, nonstreaming chat completions, and an output token limit. Generic compatible servers use `max_tokens`; direct OpenAI uses `max_completion_tokens`, and known OpenAI reasoning model families omit unsupported temperature controls. Other models use temperature 0.1. Local template options are sent only to the app-managed server; they are never included in cloud requests. Returned `<think>` blocks are removed. Some providers may require a model-specific configuration change or a different compatible endpoint. Endpoint presets do not establish account/model availability; choose a returned ID or enter an explicit custom ID.

## Anthropic and compatible APIs

Use `https://api.anthropic.com/v1` or another compatible API root. Enter a model ID available to your account. Requests use `x-api-key`, `anthropic-version: 2023-06-01`, a separate system prompt, messages, and max_tokens. Only text blocks are extracted from the response. Use local recognition or another configured audio provider for speech.

## Credentials

Keys are first encrypted with Windows DPAPI in the current-user scope, with connection-specific entropy. Only the versioned ciphertext is stored in Windows Credential Manager under service `CridVoice` and the connection UUID. CridVoice never writes raw keys to files or returns saved keys to React. Decrypted Rust buffers are wiped on drop; OS decrypted buffers are wiped before release. Settings retain only whether a key exists. Leaving an existing key field blank preserves it. Removing a provider removes its stored key. Portable keys remain associated with the Windows user and computer; transferring the folder does not transfer keys.

Before key lookup, a waiting request rechecks that its provider ID, endpoint, and protocol still match current settings. Changing or removing that connection makes the request fail with a retry message. Key rotation at an unchanged endpoint remains supported.

## Context and costs

When you select a remote cleanup provider, the recognized transcript, enabled application context, vocabulary, and style guidance are sent to that provider. A remote speech provider receives audio. Live cloud preview may send multiple snapshots; disable preview to send only final audio. Account charges and provider retention follow the selected service's settings. There is no CridVoice account, subscription, or hosted intermediary.

## Error handling

Connection, timeout, authentication/model, and invalid response errors appear in the app. Cleanup failures preserve the raw transcript and do not insert uncleaned text automatically. Transcription failures cannot recover text that was never recognized. Audio is discarded after processing or on the next launch following a crash.
