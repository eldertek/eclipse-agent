#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════════════════
# Eclipse Agent - Installation Script
# ═══════════════════════════════════════════════════════════════════════════
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/eldertek/eclipse-agent/main/install.sh | bash
#
# What this does:
#   1. Clones the eclipse-agent repo to ~/eclipse-agent
#   2. Installs MCP server dependencies
#   3. Configures Antigravity (GEMINI.md + mcp_config.json)
#
# To update manually: ~/eclipse-agent/scripts/update.sh
#
# ═══════════════════════════════════════════════════════════════════════════

REPO_URL="${ECLIPSE_REPO_URL:-https://github.com/eldertek/eclipse-agent.git}"
INSTALL_DIR="${ECLIPSE_INSTALL_DIR:-$HOME/eclipse-agent}"
GEMINI_DIR="$HOME/.gemini"
ANTIGRAVITY_DIR="$GEMINI_DIR/antigravity"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${BLUE}[eclipse]${NC} $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ───────────────────────────────────────────────────────────────────────────
# Prerequisites
# ───────────────────────────────────────────────────────────────────────────

check_prerequisites() {
    log "Checking prerequisites..."
    
    command -v git >/dev/null 2>&1 || error "git is required but not installed"
    command -v node >/dev/null 2>&1 || error "node is required but not installed"
    command -v npm >/dev/null 2>&1 || error "npm is required but not installed"
    
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        error "Node.js 18+ is required (found v$NODE_VERSION)"
    fi
    
    success "Prerequisites OK (node v$(node -v | cut -d'v' -f2))"
}

# ───────────────────────────────────────────────────────────────────────────
# Clone or Update Repository
# ───────────────────────────────────────────────────────────────────────────

setup_repo() {
    log "Setting up repository..."
    
    if [ -d "$INSTALL_DIR/.git" ]; then
        log "Repository exists, pulling latest..."
        cd "$INSTALL_DIR"
        git fetch origin
        git reset --hard origin/main
        success "Repository updated"
    else
        if [ -d "$INSTALL_DIR" ]; then
            warn "Directory exists but is not a git repo, backing up..."
            mv "$INSTALL_DIR" "$INSTALL_DIR.backup.$(date +%s)"
        fi
        log "Cloning repository..."
        git clone "$REPO_URL" "$INSTALL_DIR"
        success "Repository cloned to $INSTALL_DIR"
    fi
}

# ───────────────────────────────────────────────────────────────────────────
# Install MCP Dependencies
# ───────────────────────────────────────────────────────────────────────────

install_mcp() {
    log "Installing MCP server dependencies..."
    
    cd "$INSTALL_DIR/mcp/agent-core-server"
    npm install --silent
    
    # Rebuild native modules if needed
    npm rebuild better-sqlite3 --silent 2>/dev/null || true
    
    success "MCP dependencies installed"
}

# ───────────────────────────────────────────────────────────────────────────
# Configure Antigravity & Gemini CLI
# ───────────────────────────────────────────────────────────────────────────

configure_antigravity() {
    log "Running setup scripts..."

    # Run setup-antigravity.sh
    if [ -x "$INSTALL_DIR/scripts/setup-antigravity.sh" ]; then
        "$INSTALL_DIR/scripts/setup-antigravity.sh"
    else
        # Fallback if script not found (e.g., in old checkout without update)
        error "Setup script not found: $INSTALL_DIR/scripts/setup-antigravity.sh"
    fi

    # Run setup-gemini-cli.sh
    if [ -x "$INSTALL_DIR/scripts/setup-gemini-cli.sh" ]; then
        "$INSTALL_DIR/scripts/setup-gemini-cli.sh"
    else
        error "Setup script not found: $INSTALL_DIR/scripts/setup-gemini-cli.sh"
    fi
}

# ───────────────────────────────────────────────────────────────────────────
# Configure Claude Code Agents
# ───────────────────────────────────────────────────────────────────────────

configure_claude_agents() {
    log "Setting up Claude Code agents..."

    # Run setup-claude-agents.sh
    if [ -x "$INSTALL_DIR/scripts/setup-claude-agents.sh" ]; then
        "$INSTALL_DIR/scripts/setup-claude-agents.sh"
    else
        warn "Claude agents setup script not found (optional): $INSTALL_DIR/scripts/setup-claude-agents.sh"
    fi
}

# ───────────────────────────────────────────────────────────────────────────
# Main
# ───────────────────────────────────────────────────────────────────────────

main() {
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "  Eclipse Agent Installer"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    check_prerequisites
    setup_repo
    install_mcp
    configure_antigravity
    configure_claude_agents

    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    success "Installation complete!"
    echo ""
    echo "  Install directory:  $INSTALL_DIR"
    echo "  System prompt:      $GEMINI_DIR/GEMINI.md"
    echo "  MCP config:         $ANTIGRAVITY_DIR/mcp_config.json"
    echo "  Claude agents:      ~/.claude/agents/"
    echo ""
    echo "  Gemini CLI:  Start a new session, run '/mcp list'"
    echo "  Claude Code: Run '/agents' to see available agents"
    echo "  To update:   ~/eclipse-agent/scripts/update.sh"
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
}

main "$@"
