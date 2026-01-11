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

## All 18 Tools

| Category | Tool | Description |
|----------|------|-------------|
| **Workflow** | `begin_task` | Start a task (auto-searches memory) |
| | `end_task` | Finish a task (auto-suggests skills) |
| | `checkpoint` | Log progress |
| | `task_resume` | Resume previous session |
| **Memory** | `memory_save` | Save knowledge (types: semantic, procedural, episodic, skill) |
| | `memory_search` | Search memories (semantic similarity) |
| | `memory_update` | Update existing memory |
| | `memory_forget` | Delete obsolete memory |
| | `memory_stats` | View memory statistics |
| | `memory_maintain` | Find similar, merge, prune memories |
| | `memory_link` | Connect related memories |
| **Profile** | `profile_info` | View current profile |
| **Decisions** | `decision_log` | Record technical decisions |
| | `decision_search` | Query past decisions |
| **Intelligence** | `file_context_scan` | 🛡️ Watchdog: Scan memories before modifying files |
| | `session_postmortem` | 🔍 Auto-learn from failed sessions |
| | `tool_wishlist` | 💡 Suggest missing tools/capabilities |


## Memory Types

| Type | Description | Examples |
|------|-------------|----------|
| `semantic` | Facts & knowledge | Conventions, architecture, preferences |
| `procedural` | How to do things | Workflows, patterns, best practices |
| `episodic` | Past experiences | Decisions, errors, lessons learned |
| `skill` | Structured how-to | TRIGGER/STEPS/RELATED format |

## Skills / Personas

Activate specialized personas with `begin_task(skill: "...")`:

| Skill | Persona | Focus |
|-------|---------|-------|
| `design` | 🎨 Palette | UX, accessibility, visual polish |
| `performance` | ⚡ Bolt | Speed optimization, efficiency |
| `security` | 🛡️ Sentinel | Vulnerability detection, hardening |
| `review` | 🔍 Reviewer | Post-project introspection |
| `discovery` | 🕵️ Sherlock | Codebase exploration & task finding |
| `innovation` | ✨ Spark | Product ideas & features |
| `architecture` | 🏛️ Atlas | Structure & Refactoring |
| `test` | 🎯 Hunter | Testing & QA |
| `documentation` | 📜 Scribe | Docs & Guides |
| `general` | - | No specialized prompt (default) |

Skills load prompts from `/prompts/{skill}.md`.

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
