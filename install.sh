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
#   4. Sets up auto-update via cron (daily)
#
# ═══════════════════════════════════════════════════════════════════════════

REPO_URL="${ECLIPSE_REPO_URL:-https://github.com/USERNAME/eclipse-agent.git}"
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
# Configure Antigravity
# ───────────────────────────────────────────────────────────────────────────

configure_antigravity() {
    log "Configuring Antigravity..."
    
    # Create directories
    mkdir -p "$ANTIGRAVITY_DIR"
    mkdir -p "$ANTIGRAVITY_DIR/agent-data"
    
    # Copy GEMINI.md (system prompt)
    cp "$INSTALL_DIR/config/GEMINI.md" "$GEMINI_DIR/GEMINI.md"
    success "System prompt installed → $GEMINI_DIR/GEMINI.md"
    
    # Generate mcp_config.json with correct paths
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
    success "MCP config installed → $ANTIGRAVITY_DIR/mcp_config.json"
}

# ───────────────────────────────────────────────────────────────────────────
# Setup Auto-Update
# ───────────────────────────────────────────────────────────────────────────

setup_autoupdate() {
    log "Setting up auto-update..."
    
    UPDATE_SCRIPT="$INSTALL_DIR/scripts/update.sh"
    
    # Check if cron job already exists
    if crontab -l 2>/dev/null | grep -q "eclipse-agent/scripts/update.sh"; then
        success "Auto-update already configured"
        return
    fi
    
    # Add daily update cron job (runs at 4 AM)
    (crontab -l 2>/dev/null || true; echo "0 4 * * * $UPDATE_SCRIPT >> $INSTALL_DIR/logs/update.log 2>&1") | crontab -
    
    success "Auto-update configured (daily at 4 AM)"
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
    setup_autoupdate
    
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    success "Installation complete!"
    echo ""
    echo "  Install directory:  $INSTALL_DIR"
    echo "  System prompt:      $GEMINI_DIR/GEMINI.md"
    echo "  MCP config:         $ANTIGRAVITY_DIR/mcp_config.json"
    echo "  Auto-update:        Daily at 4 AM"
    echo ""
    echo "  To use: Start a new Gemini CLI session"
    echo "  To verify: Run '/mcp list' in Gemini CLI"
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
}

main "$@"
