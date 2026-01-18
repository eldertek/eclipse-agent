#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════════════════
# Eclipse Agent - Claude Code Agents Setup Script
# ═══════════════════════════════════════════════════════════════════════════
#
# This script installs Eclipse Agent prompts as Claude Code subagents.
# Agents are copied to ~/.claude/agents/ for user-level availability.
#
# ═══════════════════════════════════════════════════════════════════════════

INSTALL_DIR="${ECLIPSE_INSTALL_DIR:-$HOME/eclipse-agent}"
CLAUDE_AGENTS_DIR="$HOME/.claude/agents"
SOURCE_AGENTS_DIR="$INSTALL_DIR/claude-agents"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${BLUE}[eclipse]${NC} $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }

# ───────────────────────────────────────────────────────────────────────────
# Install Claude Code Agents
# ───────────────────────────────────────────────────────────────────────────

install_claude_agents() {
    log "Setting up Claude Code agents..."

    # Create Claude agents directory if it doesn't exist
    mkdir -p "$CLAUDE_AGENTS_DIR"

    # Check if source agents exist
    if [ ! -d "$SOURCE_AGENTS_DIR" ]; then
        warn "Claude agents source directory not found: $SOURCE_AGENTS_DIR"
        return 0
    fi

    # Count agents
    AGENT_COUNT=$(find "$SOURCE_AGENTS_DIR" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')

    if [ "$AGENT_COUNT" -eq 0 ]; then
        warn "No agent files found in $SOURCE_AGENTS_DIR"
        return 0
    fi

    # Copy all agent files
    INSTALLED=0
    for agent_file in "$SOURCE_AGENTS_DIR"/*.md; do
        if [ -f "$agent_file" ]; then
            agent_name=$(basename "$agent_file")
            cp "$agent_file" "$CLAUDE_AGENTS_DIR/$agent_name"
            INSTALLED=$((INSTALLED + 1))
        fi
    done

    success "Installed $INSTALLED Claude Code agents to $CLAUDE_AGENTS_DIR"
}

# ───────────────────────────────────────────────────────────────────────────
# List Installed Agents
# ───────────────────────────────────────────────────────────────────────────

list_agents() {
    if [ -d "$CLAUDE_AGENTS_DIR" ]; then
        echo ""
        log "Installed Eclipse agents:"
        for agent_file in "$CLAUDE_AGENTS_DIR"/*.md; do
            if [ -f "$agent_file" ]; then
                agent_name=$(basename "$agent_file" .md)
                echo "    - $agent_name"
            fi
        done
        echo ""
    fi
}

# ───────────────────────────────────────────────────────────────────────────
# Main
# ───────────────────────────────────────────────────────────────────────────

main() {
    install_claude_agents
    list_agents
}

main "$@"
