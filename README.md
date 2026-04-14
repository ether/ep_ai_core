# ep_ai_core

Core AI infrastructure for Etherpad. Provides shared LLM client, access control,
and authorship analysis used by `ep_ai_mcp` and `ep_ai_chat`.

## Installation

```bash
pnpm run plugins i ep_ai_core
```

Or install from npm in your Etherpad directory.

## Configuration

Add an `ep_ai_core` block to your `settings.json`:

```json
{
  "ep_ai_core": {
    "apiBaseUrl": "https://api.anthropic.com/v1",
    "apiKey": "sk-ant-...",
    "model": "claude-sonnet-4-20250514",
    "maxTokens": 4096,
    "provider": "anthropic",
    "access": {
      "defaultMode": "full",
      "pads": {
        "private-*": "none",
        "readonly-*": "readOnly"
      }
    },
    "chat": {
      "trigger": "@ai",
      "authorName": "AI Assistant",
      "authorColor": "#7c4dff",
      "systemPrompt": null,
      "maxContextChars": 50000,
      "chatHistoryLength": 20,
      "conversationBufferSize": 10
    }
  }
}
```

### OpenAI-compatible provider

To use OpenAI, Ollama, or any OpenAI-compatible API, set the base URL and
omit `provider` (auto-detected) or set it to `"openai"`:

```json
{
  "ep_ai_core": {
    "apiBaseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-...",
    "model": "gpt-4o",
    "provider": "openai"
  }
}
```

## Access Control

The `access` section controls which pads the AI can read or write. Pad IDs are
matched against glob patterns using [minimatch](https://github.com/isaacs/minimatch).

| Mode       | Read | Write |
|------------|------|-------|
| `full`     | Yes  | Yes   |
| `readOnly` | Yes  | No    |
| `none`     | No   | No    |

`defaultMode` applies to any pad that does not match a pattern in `pads`.
Default is `full`.

## API for Other Plugins

```js
const epAiCore = require('ep_ai_core/index');
```

### Exports

- **`getSettings()`** -- returns the current `ep_ai_core` settings object.
- **`accessControl`** -- `{ getAccessMode, canRead, canWrite }`. Each takes
  `(padId, aiSettings)`.
- **`llmClient`** -- `{ create(config) }`. Returns a client with a
  `complete(messages, options)` method. Supports Anthropic and OpenAI-compatible
  APIs.
- **`authorship`** -- `{ getCurrentAttribution, getPadContributors, getRevisionProvenance, getPadActivity }`. Analyze per-paragraph attribution, contributor stats,
  text provenance across revisions, and pad activity timelines.

## Supported LLM Providers

- **Anthropic** (native Messages API) -- auto-detected when `apiBaseUrl`
  contains `anthropic.com`, or set `"provider": "anthropic"`.
- **OpenAI-compatible** -- any endpoint implementing `/chat/completions`.
  Works with OpenAI, Azure OpenAI, Ollama, LM Studio, and similar.

## License

Apache-2.0
