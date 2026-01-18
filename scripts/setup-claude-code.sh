#!/bin/bash
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_PATH="$REPO_ROOT/mcp/agent-core-server/index.js"
HOOKS_DIR="$REPO_ROOT/hooks"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${BLUE}[eclipse]${NC} $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }

# ─────────────────────────────────────────────────────────────
# 1. Configure MCP Server in ~/.claude.json
# ─────────────────────────────────────────────────────────────
log "Configuring MCP server..."

node -e "
const fs = require('fs');
const configPath = process.env.HOME + '/.claude.json';
const serverPath = '$SERVER_PATH';

let config = {};
if (fs.existsSync(configPath)) {
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) {}
}

if (!config.mcpServers) config.mcpServers = {};

config.mcpServers['eclipse'] = {
    type: 'stdio',
    command: 'node',
    args: [serverPath]
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('MCP server registered in ~/.claude.json');
"

success "MCP server 'eclipse' added to ~/.claude.json"

# ─────────────────────────────────────────────────────────────
# 2. Create data directory
# ─────────────────────────────────────────────────────────────
mkdir -p "$HOME/.eclipse-agent"
success "Data directory: ~/.eclipse-agent/"

# ─────────────────────────────────────────────────────────────
# 3. Setup Skills (auto-triggered by Claude)
# ─────────────────────────────────────────────────────────────
log "Installing Eclipse skills..."

SKILLS_DIR="$HOME/.claude/skills"
mkdir -p "$SKILLS_DIR"

# Memory Skill
mkdir -p "$SKILLS_DIR/eclipse-memory"
cat > "$SKILLS_DIR/eclipse-memory/SKILL.md" << 'EOF'
---
name: eclipse-memory
description: Long-term memory management with semantic search. Use when saving knowledge, searching past decisions, recalling project context, or managing learned patterns.
---

# Eclipse Memory System

You have access to the Eclipse MCP server with semantic memory capabilities.

## Quick Actions

When invoked via `/memory` or automatically:

1. **Search First** - Use `memory_search` with the current task context
2. **Show Relevant** - Display any related memories found
3. **Suggest Saves** - If working on something new, prompt to save

## Memory Types

| Type | Use For | Example |
|------|---------|---------|
| `semantic` | Facts, architecture | "API uses JWT auth with 1hr expiry" |
| `procedural` | How-to, workflows | "Deploy: npm build, then docker push" |
| `episodic` | Lessons learned | "Don't use library X, causes memory leak" |
| `skill` | Reusable techniques | "TRIGGER: DB slow -> CHECK: indexes" |

## Tools Available

- `memory_search` - Semantic search across all memories
- `memory_save` - Store new knowledge
- `memory_update` - Modify existing memory
- `memory_forget` - Delete outdated info
- `memory_link` - Connect related memories
- `memory_stats` - View usage statistics
- `memory_maintain` - Cleanup and optimization

## Auto-Save Triggers

Consider saving when you:
- Discover a bug pattern -> `episodic`
- Learn project architecture -> `semantic`
- Figure out a workflow -> `procedural`
- Create a reusable technique -> `skill`
EOF

success "Installed skill: eclipse-memory"

# Workflow Skill
mkdir -p "$SKILLS_DIR/eclipse-workflow"
cat > "$SKILLS_DIR/eclipse-workflow/SKILL.md" << 'EOF'
---
name: eclipse-workflow
description: Task management with begin_task/end_task workflow. Use when starting complex tasks, tracking progress, or completing work sessions.
---

# Eclipse Workflow System

Use specialized **subagents** for complex tasks and Eclipse tools for memory/tracking.

## Subagents (Use Task tool)

Instead of doing everything yourself, delegate to specialized agents:

| Agent | Use For |
|-------|---------|
| `bolt` | Performance optimization, profiling |
| `hunter` | Testing, QA, bug hunting |
| `scribe` | Documentation, READMEs |
| `sentinel` | Security audits, vulnerabilities |
| `atlas` | Architecture analysis, refactoring |
| `sherlock` | Code exploration, finding TODOs |
| `spark` | Feature ideation, innovation |
| `reviewer` | Code review, quality checks |
| `palette` | UX improvements, accessibility |
| `polyglot` | i18n, translations |
| `navigator` | Browser automation, E2E testing |
| `boardroom` | Business decisions, multi-perspective |

## Eclipse Memory Tools

Use alongside subagents for context:

- `begin_task` - Search memory + create tracking session
- `checkpoint` - Log progress during work
- `end_task` - Complete with quality gates
- `memory_search` - Find relevant past knowledge
- `decision_log` - Record important decisions

## Recommended Flow

1. **Start**: `begin_task` to get memory context
2. **Delegate**: Use Task tool with appropriate subagent
3. **Track**: `checkpoint` for significant progress
4. **Save**: `memory_save` for new learnings
5. **Complete**: `end_task` with verification
EOF

success "Installed skill: eclipse-workflow"

# Stats Skill - show memory statistics
mkdir -p "$SKILLS_DIR/eclipse-stats"
cat > "$SKILLS_DIR/eclipse-stats/SKILL.md" << 'EOF'
---
name: eclipse-stats
description: Show Eclipse memory statistics and session info. Use when checking memory usage, viewing past decisions, or getting an overview of stored knowledge.
---

# Eclipse Statistics

Show a comprehensive overview of the Eclipse memory system.

## Instructions

When this skill is invoked, use the `memory_stats` MCP tool to display:

1. **Memory Overview**
   - Total memories by type (semantic, procedural, episodic, skill)
   - Memories by scope (profile vs global)

2. **Access Patterns**
   - Most accessed memories
   - Never accessed memories (cleanup candidates)

3. **Health Status**
   - Memory decay status
   - Oldest memories

## After Displaying Stats

Suggest actions based on stats:
- If many never-accessed memories: suggest `memory_maintain` with prune
- If no recent decisions: remind about `decision_log`
- If low memory count: encourage saving knowledge
EOF

success "Installed skill: eclipse-stats"

# ─────────────────────────────────────────────────────────────
# 4. Setup Comprehensive Hooks
# ─────────────────────────────────────────────────────────────
log "Configuring comprehensive hooks..."

SETTINGS_FILE="$HOME/.claude/settings.json"

node -e "
const fs = require('fs');
const settingsPath = '$SETTINGS_FILE';
const hooksDir = '$HOOKS_DIR';

let settings = {};
if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (e) {}
}

// Initialize hooks structure
if (!settings.hooks) settings.hooks = {};

// Remove old invalid hook names (from previous versions)
delete settings.hooks.PreToolCall;
delete settings.hooks.PostToolCall;

// ═══════════════════════════════════════════════════════════════════════════
// SESSION START HOOK
// Provides context awareness at the beginning of each session
// ═══════════════════════════════════════════════════════════════════════════
settings.hooks.SessionStart = [{
    matcher: '',
    hooks: [{
        type: 'command',
        command: hooksDir + '/session-start.sh'
    }]
}];

// ═══════════════════════════════════════════════════════════════════════════
// PRE-TOOL USE HOOKS
// Warnings and context before critical operations
// ═══════════════════════════════════════════════════════════════════════════
if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];

// Clear existing Eclipse hooks
settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(h =>
    !h.hooks || !h.hooks.some(hook => hook.command && hook.command.includes('eclipse'))
);

// Pre-Edit: Warn about critical files
settings.hooks.PreToolUse.push({
    matcher: 'Edit',
    hooks: [{
        type: 'command',
        command: hooksDir + '/pre-edit-warning.sh'
    }]
});

// Pre-Write: Same warning for new files
settings.hooks.PreToolUse.push({
    matcher: 'Write',
    hooks: [{
        type: 'command',
        command: hooksDir + '/pre-edit-warning.sh'
    }]
});

// ═══════════════════════════════════════════════════════════════════════════
// POST-TOOL USE HOOKS
// Logging and suggestions after operations
// ═══════════════════════════════════════════════════════════════════════════
if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];

// Clear existing Eclipse hooks
settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(h =>
    !h.hooks || !h.hooks.some(hook => hook.command && hook.command.includes('eclipse'))
);

// Post-Bash: Log git commits
settings.hooks.PostToolUse.push({
    matcher: 'Bash',
    hooks: [{
        type: 'command',
        command: hooksDir + '/post-commit-log.sh'
    }]
});

// ═══════════════════════════════════════════════════════════════════════════
// STOP HOOK
// Reminder to save learnings when session ends
// ═══════════════════════════════════════════════════════════════════════════
settings.hooks.Stop = [{
    matcher: '',
    hooks: [{
        type: 'command',
        command: hooksDir + '/task-reminder.sh'
    }]
}];

// ═══════════════════════════════════════════════════════════════════════════
// USER PROMPT SUBMIT HOOK
// Analyze prompts for context keywords
// ═══════════════════════════════════════════════════════════════════════════
settings.hooks.UserPromptSubmit = [{
    matcher: '',
    hooks: [{
        type: 'command',
        command: hooksDir + '/prompt-analyzer.sh \"\$PROMPT\"'
    }]
}];

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATION HOOK
// Custom notifications for Eclipse events
// ═══════════════════════════════════════════════════════════════════════════
settings.hooks.Notification = [{
    matcher: '',
    hooks: [{
        type: 'command',
        command: 'echo \"[Eclipse] \$MESSAGE\"'
    }]
}];

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log('Comprehensive hooks configured');
"

success "Hooks configured:"
echo "    - SessionStart: Welcome + memory context"
echo "    - PreToolUse (Edit/Write): Critical file warnings"
echo "    - PostToolUse (Bash): Git commit logging"
echo "    - Stop: Learning reminder"
echo "    - UserPromptSubmit: Context keyword detection"
echo "    - Notification: Eclipse event display"

# ─────────────────────────────────────────────────────────────
# 5. Summary
# ─────────────────────────────────────────────────────────────
echo ""
log "Eclipse Agent configured successfully!"
echo ""
echo "  MCP Server:  eclipse (in ~/.claude.json)"
echo "  Data:        ~/.eclipse-agent/"
echo "  Skills:      eclipse-memory, eclipse-workflow, eclipse-stats"
echo "  Hooks:       6 hooks configured"
echo ""
