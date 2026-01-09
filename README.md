# Eclipse Agent

A minimal, powerful AI code agent framework with long-term memory and structured workflows.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/eldertek/eclipse-agent/main/install.sh | bash
```

## Core Workflow (3 tools)

```
begin_task("what you're doing")
    ↓
checkpoint("progress note")
    ↓
end_task("summary")
```

That's it. Everything else is optional.

## All 15 Tools

| Category | Tool | Description |
|----------|------|-------------|
| **Workflow** | `begin_task` | Start a task (auto-searches memory) |
| | `end_task` | Finish a task (auto-suggests skills) |
| | `checkpoint` | Log progress |
| | `task_resume` | Resume previous session |
| | `skill_from_session` | Generate skill from checkpoints |
| **Memory** | `memory_save` | Save knowledge (types: semantic, procedural, episodic, skill) |
| | `memory_search` | Search memories |
| | `memory_update` | Update existing memory |
| | `memory_forget` | Delete obsolete memory |
| | `memory_stats` | View memory statistics |
| | `memory_cluster` | Find similar memories |
| | `memory_compress` | Clean up old memories |
| **Profile** | `profile_info` | View current profile |
| **Decisions** | `decision_log` | Record technical decisions |
| | `decision_search` | Query past decisions |

## Memory Types

| Type | Description | Examples |
|------|-------------|----------|
| `semantic` | Facts & knowledge | Conventions, architecture, preferences |
| `procedural` | How to do things | Workflows, patterns, best practices |
| `episodic` | Past experiences | Decisions, errors, lessons learned |
| `skill` | Structured how-to | TRIGGER/STEPS/RELATED format |

## Update

```bash
~/eclipse-agent/scripts/update.sh
```

## Diagnose

```bash
~/eclipse-agent/scripts/doctor.sh
```

## Data Storage

```
~/.gemini/antigravity/agent-data/profiles/{project}/memory.db
```

## Uninstall

```bash
rm -rf ~/eclipse-agent
rm ~/.gemini/GEMINI.md
rm ~/.gemini/antigravity/mcp_config.json
rm -rf ~/.gemini/antigravity/agent-data  # Optional: removes all memories
```

## License

MIT
