# Eclipse Agent

A minimal, powerful AI code agent framework with long-term memory, structured workflows, and auto-updating MCPs.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/eldertek/eclipse-agent/main/install.sh | bash
```

Or with custom repo:

```bash
ECLIPSE_REPO_URL=https://github.com/eldertek/eclipse-agent.git \
curl -fsSL https://raw.githubusercontent.com/eldertek/eclipse-agent/main/install.sh | bash
```

## What It Does

The installer:

1. **Clones** the repo to `~/eclipse-agent`
2. **Installs** MCP server dependencies
3. **Configures** Antigravity/Gemini CLI:
   - `~/.gemini/GEMINI.md` - System prompt
   - `~/.gemini/antigravity/mcp_config.json` - MCP configuration
4. **Sets up** daily auto-update via cron

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
├── scripts/
│   └── update.sh           # Auto-update script (cron)
└── logs/
    └── update.log          # Update history
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

## Auto-Update

The installer sets up a daily cron job (4 AM) that:

1. Pulls latest changes from the repo
2. Rebuilds MCP dependencies if `package.json` changed
3. Updates `GEMINI.md` and `mcp_config.json`

To manually update:

```bash
~/eclipse-agent/scripts/update.sh
```

To check update logs:

```bash
cat ~/eclipse-agent/logs/update.log
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

## Customization

### Add Project Context

Create a project-specific `.gemini/GEMINI.md`:

```markdown
<project_context>
This is a TypeScript/Next.js project.
Tests use Jest.
Deploy target is Vercel.
</project_context>
```

### Add More MCPs

Edit `~/.gemini/antigravity/mcp_config.json`:

```json
{
  "mcpServers": {
    "core": { ... },
    "custom": {
      "command": "node",
      "args": ["/path/to/your/mcp/index.js"]
    }
  }
}
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

# Remove cron job
crontab -l | grep -v eclipse-agent | crontab -

# Optionally remove data
rm -rf ~/.gemini/antigravity/agent-data
```

## License

MIT
