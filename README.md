# imp

`imp` is a local daemon for running personal AI agents behind persistent conversation endpoints.

It is meant for personal automation where conversation sessions should keep context, agents should be reachable through communication channels such as Telegram, and the runtime should remain under local control.

`imp` is early-stage and can still change.

## Core Concepts

### Agents

Agents define how `imp` should answer within a conversation. An agent combines a model, prompt customization, tools, optional skills, and an optional workspace. Multiple agents can live in one daemon so different roles can share the same runtime while keeping their own behavior and working context.

### Endpoints

Endpoints define where conversations enter the system. Telegram and local CLI chat are supported endpoint types. Endpoints are transport-facing, own their runtime files and conversation store, and route messages to a default agent unless a conversation selects another configured agent. The local CLI chat endpoint is started directly with `imp chat`; it is not started by the daemon service.

### Transports

Transports connect endpoint types to external systems. The built-in Telegram transport receives Telegram messages, sends them into `imp`, and delivers responses back to Telegram. The built-in CLI transport powers `imp chat` for a local terminal conversation.
