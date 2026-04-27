# Providers

Each agent uses one effective model config. An agent can define its own `model`, or inherit
`defaults.model`. If an agent defines `model`, that model config replaces the default model
config for that agent.

The examples use `agents.default` to address the agent with the ID `default`.

## Choose a Model

Set the provider and model ID:

```sh
imp config set defaults.model.provider openai
imp config set defaults.model.modelId gpt-5.4
```

You can also set the model object at once:

```sh
imp config set defaults.model '{"provider":"openai","modelId":"gpt-5.4"}'
```

Validate the config after changing a model:

```sh
imp config validate
```

## Credentials

Imp uses the provider registry from [`@mariozechner/pi-ai`](https://www.npmjs.com/package/@mariozechner/pi-ai). The current installation supports these built-in providers:

- `amazon-bedrock`: AWS credentials through the normal AWS environment, profile, container, web identity, or Bedrock bearer-token mechanisms. Region comes from `AWS_REGION`, `AWS_DEFAULT_REGION`, or the AWS profile configuration.
- `anthropic`: `ANTHROPIC_API_KEY` or `ANTHROPIC_OAUTH_TOKEN`
- `azure-openai-responses`: `AZURE_OPENAI_API_KEY` plus `AZURE_OPENAI_BASE_URL` or `AZURE_OPENAI_RESOURCE_NAME`
- `cerebras`: `CEREBRAS_API_KEY`
- `github-copilot`: `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, or GitHub Copilot OAuth credentials
- `google`: `GEMINI_API_KEY`
- `google-antigravity`: Google OAuth credentials
- `google-gemini-cli`: Google OAuth credentials, and for some accounts `GOOGLE_CLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT_ID`
- `google-vertex`: `GOOGLE_CLOUD_API_KEY`, or Google Cloud ADC plus `GOOGLE_CLOUD_PROJECT` or `GCLOUD_PROJECT`, and `GOOGLE_CLOUD_LOCATION`
- `groq`: `GROQ_API_KEY`
- `huggingface`: `HF_TOKEN`
- `kimi-coding`: `KIMI_API_KEY`
- `minimax`: `MINIMAX_API_KEY`
- `minimax-cn`: `MINIMAX_CN_API_KEY`
- `mistral`: `MISTRAL_API_KEY`
- `openai`: `OPENAI_API_KEY`
- `openai-codex`: OpenAI Codex OAuth credentials
- `opencode`: `OPENCODE_API_KEY`
- `opencode-go`: `OPENCODE_API_KEY`
- `openrouter`: `OPENROUTER_API_KEY`
- `vercel-ai-gateway`: `AI_GATEWAY_API_KEY`
- `xai`: `XAI_API_KEY`
- `zai`: `ZAI_API_KEY`

You can pin an API key source directly to a model config:

```sh
imp config set defaults.model.apiKey '{"env":"OPENAI_API_KEY"}'
```

`apiKey` accepts the same secret forms as endpoint tokens: inline string, `{"env":"NAME"}`,
or `{"file":"./secrets/provider.key"}`.

## OAuth Credentials

Some providers use OAuth credential files instead of API keys. Set `authFile` on the model
config when the provider supports it:

```sh
imp config set defaults.model.authFile /path/to/auth.json
```

For OpenAI Codex credentials, create the auth file with:

```sh
npx @mariozechner/pi-ai login openai-codex
```

## Service Credentials

Provider credentials must be available to the process that runs Imp. If Imp runs as a service, make sure the service environment contains the required variables.

On Linux, reinstall the service after changing service environment values:

```sh
imp service install --force
```
