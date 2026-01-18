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

## When to Use Memory

1. **Save Knowledge** - When you learn something important about the project
2. **Search Memory** - Before starting tasks, search for relevant context
3. **Log Decisions** - Record technical decisions with rationale
4. **Link Memories** - Connect related pieces of knowledge

## Memory Types

- `semantic` - Facts, architecture, patterns
- `procedural` - Workflows, how-to guides
- `episodic` - Decisions, lessons learned
- `skill` - Reusable techniques

## Best Practices

- Search memory at the start of complex tasks
- Save discoveries that would be useful later
- Link related memories to build knowledge graphs
- Use decision_log for important technical choices
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

Structure your work with task tracking for better context and memory integration.

## Starting Work

Always use `begin_task` when starting non-trivial work:
- Automatically searches memory for relevant context
- Loads specialized skill prompts if needed
- Creates a tracking session for checkpoints

## During Work

Use `checkpoint` to log significant progress:
- High importance checkpoints suggest memory saves
- Decision-related notes suggest decision_log

## Ending Work

Use `end_task` when finishing:
- Quality gates enforce tests and documentation
- Suggests saving learnings to memory
- Prevents premature task closure

## Skills Available

design, performance, security, review, discovery, innovation, architecture, test, documentation, browser, translate
EOF

success "Installed skill: eclipse-workflow"

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
echo "  Skills:      eclipse-memory, eclipse-workflow"
echo "  Hooks:       6 hooks configured"
echo ""
