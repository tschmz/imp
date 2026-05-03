# Providers

Each agent uses one model configuration. An agent can define its own model, or inherit `defaults.model`.

The examples use `defaults.model` so every agent without its own model uses the same provider.

## Choose a Model

Set provider and model ID:

```sh
imp config set defaults.model.provider openai
imp config set defaults.model.modelId gpt-5.5
```

Or set both at once:

```sh
imp config set defaults.model '{"provider":"openai","modelId":"gpt-5.5"}'
```

Validate after changing a model:

```sh
imp config validate
```

## Credentials

Provider credentials must be available to the process that runs Imp. For an interactive chat, this is your shell. For a service, this is the service environment.

Common built-in providers and credential variables include:

| Provider | Common credential |
| --- | --- |
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` or `ANTHROPIC_OAUTH_TOKEN` |
| `google` | `GEMINI_API_KEY` |
| `google-vertex` | Google Cloud ADC or `GOOGLE_CLOUD_API_KEY` plus project/location variables |
| `azure-openai-responses` | `AZURE_OPENAI_API_KEY` plus Azure endpoint settings |
| `openrouter` | `OPENROUTER_API_KEY` |
| `groq` | `GROQ_API_KEY` |
| `mistral` | `MISTRAL_API_KEY` |
| `xai` | `XAI_API_KEY` |
| `amazon-bedrock` | AWS credentials and region settings |
| `github-copilot` | GitHub/Copilot token or OAuth credentials |

Other provider IDs supported by the installed provider library include `cerebras`, `google-antigravity`, `google-gemini-cli`, `huggingface`, `kimi-coding`, `minimax`, `minimax-cn`, `openai-codex`, `opencode`, `opencode-go`, `vercel-ai-gateway`, and `zai`.

## Pin a Credential Source

You can point a model directly at an environment variable:

```sh
imp config set defaults.model.apiKey '{"env":"OPENAI_API_KEY"}'
```

`apiKey` accepts inline strings, environment variable references, and secret file references:

```sh
imp config set defaults.model.apiKey '{"file":"./secrets/provider.key"}'
```

Prefer environment variables or secret files over inline API keys.

## OAuth Credential Files

Some providers use OAuth credential files. Set `authFile` when the provider supports it:

```sh
imp config set defaults.model.authFile /path/to/auth.json
```

For OpenAI Codex OAuth credentials, use:

```sh
npx @mariozechner/pi-ai login openai-codex
```

## Services

When Imp runs as a service, make sure the service process receives provider credentials. After changing service environment values, refresh the managed service definition if needed:

```sh
imp service install --force
imp service restart
```
