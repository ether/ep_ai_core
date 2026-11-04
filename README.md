# AI Core for Etherpad

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
    "model": "sonnet",
    "maxTokens": 16000,
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

### Choosing a model

Set `model` to a family keyword and the plugin picks the newest model in that
family, so you don't have to edit `settings.json` every time a model is
retired:

| `model`                     | Resolves to (example)          |
|-----------------------------|--------------------------------|
| `"sonnet"` (recommended)    | the newest Claude Sonnet       |
| `"opus"`                    | the newest Claude Opus         |
| `"haiku"`                   | the newest Claude Haiku        |
| `"gpt-sol"`                 | the newest `gpt-*-sol` model   |
| `"gemini-flash"`            | the newest Gemini Flash        |
| `"grok"`                    | the newest Grok                |
| `"claude-sonnet-5-5"`       | exactly that model             |

How it works:

- Any `model` value without a digit is a family keyword. The plugin looks it
  up in the provider's `GET /models` list at startup and caches the result
  for 24 hours. The resolved ID is logged (`LLM model: ...`).
- Anything with a digit is an exact model ID and is sent as-is.
- `model` is optional. On Anthropic it defaults to `"sonnet"`; on other
  providers it defaults to the newest model the endpoint lists, with a
  warning.
- If an exact ID returns 404 (the model was retired), the plugin logs one
  warning naming the replacement and retries with the newest model in the
  same family. Update `settings.json` when you see it.
- If a keyword can't be resolved (the provider has no `/models` endpoint, or
  nothing matches), the value is sent as an exact ID with a warning, so
  digit-free IDs such as `deepseek-chat` still work.

`maxTokens` includes the model's thinking tokens on current Claude models, so
leave it at 16000 (the default) or higher.

### OpenAI-compatible provider

To use OpenAI, Ollama, or any OpenAI-compatible API, set the base URL and
omit `provider` (auto-detected) or set it to `"openai"`:

```json
{
  "ep_ai_core": {
    "apiBaseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-...",
    "model": "gpt-sol",
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
