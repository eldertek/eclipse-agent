#!/bin/bash
set -e

# Setup Antigravity configuration (GEMINI.md and mcp_config.json)

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GEMINI_DIR="$HOME/.gemini"
ANTIGRAVITY_DIR="$GEMINI_DIR/antigravity"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${BLUE}[setup-antigravity]${NC} $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; }

log "Configuring Antigravity..."

# Create directories
mkdir -p "$ANTIGRAVITY_DIR"
mkdir -p "$ANTIGRAVITY_DIR/agent-data"

# Copy GEMINI.md (system prompt)
if [ -f "$REPO_ROOT/config/GEMINI.md" ]; then
    cp "$REPO_ROOT/config/GEMINI.md" "$GEMINI_DIR/GEMINI.md"
    success "System prompt installed → $GEMINI_DIR/GEMINI.md"
else
    echo "Warning: $REPO_ROOT/config/GEMINI.md not found, skipping."
fi

# Generate mcp_config.json with correct paths
cat > "$ANTIGRAVITY_DIR/mcp_config.json" << EOF
{
  "mcpServers": {
    "core": {
      "command": "node",
      "args": ["$REPO_ROOT/mcp/agent-core-server/index.js"]
    }
  }
}
EOF
success "MCP config installed → $ANTIGRAVITY_DIR/mcp_config.json"
