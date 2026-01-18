#!/bin/bash
# Eclipse Hook: Post-Commit Log
# Logs git commits to provide context for future sessions
# Receives JSON input via stdin with tool_input containing command

# Read JSON from stdin
INPUT=$(cat)

# Extract command from tool_input
COMMAND=$(echo "$INPUT" | node -e "
const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
console.log(data.tool_input?.command || '');
" 2>/dev/null)

# Only run if this was a git commit
if [[ "$COMMAND" != *"git"* ]] || [[ "$COMMAND" != *"commit"* ]]; then
    exit 0
fi

# Get the last commit info
if [ -d ".git" ]; then
    COMMIT_MSG=$(git log -1 --pretty=%s 2>/dev/null)
    COMMIT_HASH=$(git log -1 --pretty=%h 2>/dev/null)
    FILES_CHANGED=$(git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null | wc -l | tr -d ' ')

    if [ -n "$COMMIT_MSG" ]; then
        echo ""
        echo -e "\033[0;32m[Eclipse]\033[0m Commit logged: $COMMIT_HASH"
        echo -e "  Message: $COMMIT_MSG"
        echo -e "  Files: $FILES_CHANGED changed"
        echo -e "  \033[0;36mTip:\033[0m Use \033[0;32mdecision_log\033[0m to record why these changes were made"
        echo ""
    fi
fi
