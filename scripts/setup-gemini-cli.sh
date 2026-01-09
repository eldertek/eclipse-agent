#!/bin/bash
set -e

# Setup Gemini CLI configuration (~/.gemini/settings.json)

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GEMINI_DIR="$HOME/.gemini"
SETTINGS_FILE="$GEMINI_DIR/settings.json"
SERVER_PATH="$REPO_ROOT/mcp/agent-core-server/index.js"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${BLUE}[setup-gemini-cli]${NC} $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; }

log "Updating Gemini CLI settings..."

# Ensure directory exists
mkdir -p "$GEMINI_DIR"

# Use node to safely update the JSON file
node -e "
const fs = require('fs');
const path = '${SETTINGS_FILE}';
const serverPath = '${SERVER_PATH}';

let settings = {};
if (fs.existsSync(path)) {
    try {
        const content = fs.readFileSync(path, 'utf8');
        if (content.trim()) {
            settings = JSON.parse(content);
        }
    } catch (e) {
        console.error('Warning: Could not parse existing settings.json, starting fresh');
    }
}

if (!settings.mcpServers) settings.mcpServers = {};

settings.mcpServers['eclipse-core'] = {
    command: 'node',
    args: [serverPath]
};

fs.writeFileSync(path, JSON.stringify(settings, null, 2));
"

success "Gemini CLI settings updated → $SETTINGS_FILE"
