# Eclipse Agent

A minimal, powerful AI code agent framework with long-term memory and structured workflows.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/eldertek/eclipse-agent/main/install.sh | bash
```

## What It Does

The installer:

1. **Clones** the repo to `~/eclipse-agent`
2. **Installs** MCP server dependencies
3. **Configures** Antigravity/Gemini CLI:
   - `~/.gemini/GEMINI.md` - System prompt
   - `~/.gemini/antigravity/mcp_config.json` - MCP configuration

## Architecture

```
~/eclipse-agent/
├── install.sh              # Main installer
├── config/
│   └── GEMINI.md           # System prompt (→ ~/.gemini/GEMINI.md)
├── mcp/
│   └── agent-core-server/  # Unified MCP server
│       ├── index.js        # Server implementation
│       └── package.json    # Dependencies
└── scripts/
    └── update.sh           # Manual update script
```

## MCP Tools

The `core` MCP provides 10 tools:

| Category | Tool | Description |
|----------|------|-------------|
| **Loop** | `should_continue` | Prevents premature stopping |
| **Planning** | `task_start` | Begin a work session |
| | `phase_transition` | Move between phases |
| | `checkpoint` | Log progress |
| **Memory** | `memory_save` | Save to long-term memory |
| | `memory_search` | Search memories |
| | `memory_update` | Update existing memory |
| | `memory_forget` | Delete obsolete memory |
| **Decisions** | `decision_log` | Record technical decisions |
| | `decision_search` | Query past decisions |

## Workflow Phases

```
understand → plan → execute → verify
    🔍         📋       ⚡        ✅
```

1. **understand**: Read code, clarify requirements, research
2. **plan**: Formulate approach, identify risks
3. **execute**: Make minimal, surgical changes
4. **verify**: Test, validate, self-critique

## Memory Types

| Type | Description | Examples |
|------|-------------|----------|
| `semantic` | Facts & knowledge | Conventions, architecture, preferences |
| `procedural` | How to do things | Workflows, patterns, best practices |
| `episodic` | Past experiences | Decisions, errors, lessons learned |

## Manual Update

To update to the latest version:

```bash
~/eclipse-agent/scripts/update.sh
```

## Verify Installation

```bash
# Start Gemini CLI
gemini

# Check MCPs
/mcp list

# You should see:
# - core (10 tools)
```

## Data Storage

Persistent data is stored in:

```
~/.gemini/antigravity/agent-data/
└── agent-core.db          # SQLite database (memories, sessions, decisions)
```

## Uninstall

```bash
# Remove installation
rm -rf ~/eclipse-agent

# Remove config
rm ~/.gemini/GEMINI.md
rm ~/.gemini/antigravity/mcp_config.json

# Optionally remove data
rm -rf ~/.gemini/antigravity/agent-data
```

## License

MIT
