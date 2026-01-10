#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# Eclipse Agent - Doctor Script
# ═══════════════════════════════════════════════════════════════════════════
# Diagnoses the health of your Eclipse Agent installation

set -e

INSTALL_DIR="${ECLIPSE_INSTALL_DIR:-$HOME/eclipse-agent}"
GEMINI_DIR="$HOME/.gemini"
ANTIGRAVITY_DIR="$GEMINI_DIR/antigravity"
DATA_DIR="$ANTIGRAVITY_DIR/agent-data"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }
info() { echo -e "${BLUE}→${NC} $1"; }

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Eclipse Agent Doctor"
echo "═══════════════════════════════════════════════════════════════"
echo ""

ISSUES=0

# ───────────────────────────────────────────────────────────────────────────
# Check Node.js
# ───────────────────────────────────────────────────────────────────────────

if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | cut -d'v' -f2)
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)
    if [ "$NODE_MAJOR" -ge 18 ]; then
        ok "Node.js v$NODE_VERSION (>= 18 required)"
    else
        fail "Node.js v$NODE_VERSION (>= 18 required)"
        ISSUES=$((ISSUES + 1))
    fi
else
    fail "Node.js not found"
    ISSUES=$((ISSUES + 1))
fi

# ───────────────────────────────────────────────────────────────────────────
# Check Installation
# ───────────────────────────────────────────────────────────────────────────

if [ -d "$INSTALL_DIR" ]; then
    ok "Installation directory: $INSTALL_DIR"
else
    fail "Installation directory not found: $INSTALL_DIR"
    ISSUES=$((ISSUES + 1))
fi

if [ -f "$INSTALL_DIR/mcp/agent-core-server/index.js" ]; then
    ok "MCP server script exists"
else
    fail "MCP server script missing"
    ISSUES=$((ISSUES + 1))
fi

if [ -d "$INSTALL_DIR/mcp/agent-core-server/node_modules" ]; then
    ok "MCP dependencies installed"
else
    fail "MCP dependencies not installed (run: cd $INSTALL_DIR/mcp/agent-core-server && npm install)"
    ISSUES=$((ISSUES + 1))
fi

# ───────────────────────────────────────────────────────────────────────────
# Check Configuration
# ───────────────────────────────────────────────────────────────────────────

if [ -f "$GEMINI_DIR/GEMINI.md" ]; then
    ok "GEMINI.md installed"
else
    warn "GEMINI.md not found (run install.sh or copy from config/)"
    ISSUES=$((ISSUES + 1))
fi

if [ -f "$ANTIGRAVITY_DIR/mcp_config.json" ]; then
    ok "MCP config installed"
    
    # Check if config points to correct server
    if grep -q "agent-core-server" "$ANTIGRAVITY_DIR/mcp_config.json"; then
        ok "MCP config references agent-core-server"
    else
        warn "MCP config may not reference agent-core-server"
    fi
else
    fail "MCP config not found: $ANTIGRAVITY_DIR/mcp_config.json"
    ISSUES=$((ISSUES + 1))
fi

# ───────────────────────────────────────────────────────────────────────────
# Check Database
# ───────────────────────────────────────────────────────────────────────────

PROFILES_DIR="$DATA_DIR/profiles"
if [ -d "$PROFILES_DIR" ]; then
    PROFILE_COUNT=$(find "$PROFILES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
    ok "Profiles directory exists ($PROFILE_COUNT profiles)"
    info "  Path: $PROFILES_DIR"
    
    # Count memories across all profiles
    if command -v sqlite3 >/dev/null 2>&1; then
        TOTAL_MEMORIES=0
        for db in "$PROFILES_DIR"/*/memory.db; do
            if [ -f "$db" ]; then
                COUNT=$(sqlite3 "$db" "SELECT COUNT(*) FROM memories" 2>/dev/null || echo "0")
                TOTAL_MEMORIES=$((TOTAL_MEMORIES + COUNT))
            fi
        done
        ok "Total memories: $TOTAL_MEMORIES"
    else
        warn "sqlite3 not installed - cannot count memories (use memory_stats MCP tool instead)"
        warn "  Install with: sudo apt-get install -y sqlite3"
    fi
else
    info "No profiles yet (will be created on first use)"
fi

# ───────────────────────────────────────────────────────────────────────────
# Tool Usage Stats (aggregated across all profiles)
# ───────────────────────────────────────────────────────────────────────────

echo ""
info "Tool usage statistics (all profiles):"

if ! command -v sqlite3 >/dev/null 2>&1; then
    warn "sqlite3 not installed - cannot show tool usage stats"
    warn "  Install with: sudo apt-get install -y sqlite3"
elif [ -d "$PROFILES_DIR" ]; then
    # Auto-migrate: create tool_usage table if missing
    for db in "$PROFILES_DIR"/*/memory.db; do
        if [ -f "$db" ]; then
            sqlite3 "$db" "CREATE TABLE IF NOT EXISTS tool_usage (
                tool_name TEXT PRIMARY KEY,
                call_count INTEGER DEFAULT 0,
                last_called TEXT,
                first_called TEXT
            )" 2>/dev/null || true
        fi
    done

    # Create temp file for aggregation
    TEMP_STATS=$(mktemp)
    
    # Aggregate tool usage from all profile DBs
    for db in "$PROFILES_DIR"/*/memory.db; do
        if [ -f "$db" ]; then
            sqlite3 "$db" "SELECT tool_name, call_count FROM tool_usage" 2>/dev/null >> "$TEMP_STATS" || true
        fi
    done
    
    if [ -s "$TEMP_STATS" ]; then
        echo ""
        echo "  Tool                    Calls"
        echo "  ────────────────────────────"
        
        # Aggregate and sort by call count
        awk -F'|' '{
            tools[$1] += $2
        } END {
            for (t in tools) print tools[t] "|" t
        }' "$TEMP_STATS" | sort -t'|' -k1 -nr | head -10 | while IFS='|' read -r calls tool; do
            printf "  %-22s %5s\n" "$tool" "$calls"
        done
        
        echo ""
        
        # Show never used tools
        ALL_TOOLS="begin_task end_task checkpoint skill_from_session task_resume memory_save memory_search memory_update memory_forget memory_stats memory_maintain profile_info decision_log decision_search"
        
        NEVER_USED=""
        for tool in $ALL_TOOLS; do
            if ! grep -q "^$tool|" "$TEMP_STATS" 2>/dev/null; then
                NEVER_USED="$NEVER_USED $tool"
            fi
        done
        
        if [ -n "$NEVER_USED" ]; then
            warn "Never used:$NEVER_USED"
        else
            ok "All tools have been used at least once"
        fi
    else
        info "No tool usage data yet"
    fi
    
    rm -f "$TEMP_STATS"
else
    info "No profiles directory yet"
fi

# ───────────────────────────────────────────────────────────────────────────
# Check Embedding Model
# ───────────────────────────────────────────────────────────────────────────

CACHE_DIR="$DATA_DIR/.cache/models"
if [ -d "$CACHE_DIR/Xenova" ]; then
    MODEL_SIZE=$(du -sh "$CACHE_DIR" 2>/dev/null | cut -f1)
    ok "Embedding model cached ($MODEL_SIZE)"
else
    info "Embedding model not cached (will download on first use, ~80MB)"
fi

# ───────────────────────────────────────────────────────────────────────────
# Test MCP Server
# ───────────────────────────────────────────────────────────────────────────

echo ""
info "Testing MCP server..."

cd "$INSTALL_DIR/mcp/agent-core-server"

TOOL_COUNT=$(timeout 10 node -e "
const { spawn } = require('child_process');
const proc = spawn('node', ['index.js'], { stdio: ['pipe', 'pipe', 'pipe'] });

const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'doctor', version: '1.0.0' } } };
const list = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

proc.stdin.write(JSON.stringify(init) + '\n');
proc.stdin.write(JSON.stringify(list) + '\n');

let output = '';
proc.stdout.on('data', d => output += d);

setTimeout(() => {
  proc.kill();
  try {
    const lines = output.trim().split('\n');
    for (const line of lines) {
      const resp = JSON.parse(line);
      if (resp.result?.tools) {
        console.log(resp.result.tools.length);
        process.exit(0);
      }
    }
  } catch {}
  console.log('0');
}, 3000);
" 2>/dev/null || echo "0")

if [ "$TOOL_COUNT" -gt 0 ]; then
    ok "MCP server responds ($TOOL_COUNT tools available)"
else
    fail "MCP server not responding"
    ISSUES=$((ISSUES + 1))
fi

# ───────────────────────────────────────────────────────────────────────────
# Summary
# ───────────────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════"
if [ "$ISSUES" -eq 0 ]; then
    echo -e "  ${GREEN}All checks passed!${NC}"
else
    echo -e "  ${RED}$ISSUES issue(s) found${NC}"
fi
echo "═══════════════════════════════════════════════════════════════"
echo ""
