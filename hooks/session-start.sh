#!/bin/bash
# Eclipse Hook: Session Start
# Provides context awareness at the beginning of each session

ECLIPSE_DIR="$HOME/.eclipse-agent"
PROJECT_NAME=$(basename "$(pwd)")

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Eclipse Agent${NC} | Project: ${GREEN}$PROJECT_NAME${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Check if memory database exists for this project
PROFILE_DB="$ECLIPSE_DIR/profiles/$PROJECT_NAME/memory.db"
if [ -f "$PROFILE_DB" ]; then
    # Count memories using sqlite3
    if command -v sqlite3 &> /dev/null; then
        MEMORY_COUNT=$(sqlite3 "$PROFILE_DB" "SELECT COUNT(*) FROM memories;" 2>/dev/null || echo "0")
        DECISION_COUNT=$(sqlite3 "$PROFILE_DB" "SELECT COUNT(*) FROM decisions;" 2>/dev/null || echo "0")
        echo -e "  ${GREEN}+${NC} Memories: $MEMORY_COUNT | Decisions: $DECISION_COUNT"
    fi
fi

# Git status summary
if [ -d ".git" ]; then
    BRANCH=$(git branch --show-current 2>/dev/null)
    DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    if [ "$DIRTY" -gt 0 ]; then
        echo -e "  ${YELLOW}!${NC} Git: $BRANCH (${YELLOW}$DIRTY uncommitted${NC})"
    else
        echo -e "  ${GREEN}+${NC} Git: $BRANCH (clean)"
    fi
fi

echo ""
echo -e "  ${CYAN}Tip:${NC} Use ${GREEN}memory_search${NC} to recall past context"
echo -e "  ${CYAN}Tip:${NC} Use ${GREEN}begin_task${NC} to start with full context awareness"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
