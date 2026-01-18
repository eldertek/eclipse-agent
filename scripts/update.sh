#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════════════════
# Eclipse Agent - Auto-Update Script
# ═══════════════════════════════════════════════════════════════════════════
#
# This script is run automatically via cron to keep the agent up to date.
# It pulls the latest changes and rebuilds MCP dependencies if needed.
#
# ═══════════════════════════════════════════════════════════════════════════

INSTALL_DIR="${ECLIPSE_INSTALL_DIR:-$HOME/eclipse-agent}"
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

log() { echo "$LOG_PREFIX $1"; }

# ───────────────────────────────────────────────────────────────────────────
# Update Repository
# ───────────────────────────────────────────────────────────────────────────

update_repo() {
    cd "$INSTALL_DIR"
    
    # Fetch latest
    git fetch origin
    
    # Check if there are updates
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main)
    
    if [ "$LOCAL" = "$REMOTE" ]; then
        log "Already up to date"
        exit 0
    fi
    
    log "Updating from $LOCAL to $REMOTE..."
    
    # Pull changes
    git reset --hard origin/main
    
    log "Repository updated"
}

# ───────────────────────────────────────────────────────────────────────────
# Rebuild MCPs if package.json changed
# ───────────────────────────────────────────────────────────────────────────

rebuild_mcp() {
    cd "$INSTALL_DIR/mcp/agent-core-server"
    
    # Check if node_modules exists
    if [ ! -d "node_modules" ]; then
        log "Installing MCP dependencies..."
        npm install --silent
        npm rebuild better-sqlite3 --silent 2>/dev/null || true
        log "MCP dependencies installed"
    else
        # Check if package.json was modified
        CHANGED=$(git diff --name-only HEAD~1 HEAD -- package.json 2>/dev/null || echo "")
        if [ -n "$CHANGED" ]; then
            log "package.json changed, reinstalling dependencies..."
            npm install --silent
            npm rebuild better-sqlite3 --silent 2>/dev/null || true
            log "MCP dependencies updated"
        fi
    fi
}

# ───────────────────────────────────────────────────────────────────────────
# Update config files
# ───────────────────────────────────────────────────────────────────────────

update_config() {
    GEMINI_DIR="$HOME/.gemini"
    ANTIGRAVITY_DIR="$GEMINI_DIR/antigravity"

    # Update GEMINI.md if it changed
    if [ -f "$INSTALL_DIR/config/GEMINI.md" ]; then
        if ! diff -q "$INSTALL_DIR/config/GEMINI.md" "$GEMINI_DIR/GEMINI.md" >/dev/null 2>&1; then
            cp "$INSTALL_DIR/config/GEMINI.md" "$GEMINI_DIR/GEMINI.md"
            log "Updated GEMINI.md"
        fi
    fi

    # Ensure mcp_config.json is correct
    mkdir -p "$ANTIGRAVITY_DIR"
    cat > "$ANTIGRAVITY_DIR/mcp_config.json" << EOF
{
  "mcpServers": {
    "core": {
      "command": "node",
      "args": ["$INSTALL_DIR/mcp/agent-core-server/index.js"]
    }
  }
}
EOF
}

# ───────────────────────────────────────────────────────────────────────────
# Update Claude Code agents
# ───────────────────────────────────────────────────────────────────────────

update_claude_agents() {
    CLAUDE_AGENTS_DIR="$HOME/.claude/agents"
    SOURCE_AGENTS_DIR="$INSTALL_DIR/claude-agents"

    # Check if source agents exist
    if [ ! -d "$SOURCE_AGENTS_DIR" ]; then
        return 0
    fi

    # Create Claude agents directory if it doesn't exist
    mkdir -p "$CLAUDE_AGENTS_DIR"

    # Sync agent files
    UPDATED=0
    for agent_file in "$SOURCE_AGENTS_DIR"/*.md; do
        if [ -f "$agent_file" ]; then
            agent_name=$(basename "$agent_file")
            target_file="$CLAUDE_AGENTS_DIR/$agent_name"

            # Copy if different or doesn't exist
            if ! diff -q "$agent_file" "$target_file" >/dev/null 2>&1; then
                cp "$agent_file" "$target_file"
                UPDATED=$((UPDATED + 1))
            fi
        fi
    done

    if [ "$UPDATED" -gt 0 ]; then
        log "Updated $UPDATED Claude Code agent(s)"
    fi
}

# ───────────────────────────────────────────────────────────────────────────
# Main
# ───────────────────────────────────────────────────────────────────────────

main() {
    log "Starting update..."

    if [ ! -d "$INSTALL_DIR/.git" ]; then
        log "ERROR: $INSTALL_DIR is not a git repository"
        exit 1
    fi

    update_repo
    rebuild_mcp
    update_config
    update_claude_agents

    log "Update complete"
}

main "$@"
