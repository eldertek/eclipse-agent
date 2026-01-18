#!/bin/bash
# Eclipse Hook: Prompt Analyzer
# Analyzes user prompt for keywords and suggests memory search
# Receives JSON input via stdin with prompt field

# Read JSON from stdin
INPUT=$(cat)

# Extract prompt from input
PROMPT=$(echo "$INPUT" | node -e "
const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
console.log(data.prompt || '');
" 2>/dev/null)

if [ -z "$PROMPT" ]; then
    exit 0
fi

PROMPT_LOWER=$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]')

# Keywords that suggest memory search would help
CONTEXT_KEYWORDS=(
    "again" "before" "last time" "previously" "remember"
    "why did" "how did" "what was"
    "fix" "bug" "error" "issue" "problem"
    "same" "similar" "like before"
    "continue" "resume" "pick up"
)

SHOULD_SEARCH=false

for keyword in "${CONTEXT_KEYWORDS[@]}"; do
    if [[ "$PROMPT_LOWER" == *"$keyword"* ]]; then
        SHOULD_SEARCH=true
        break
    fi
done

if [ "$SHOULD_SEARCH" = true ]; then
    echo ""
    echo -e "\033[0;36m[Eclipse]\033[0m This seems related to past work."
    echo -e "  \033[0;33m->\033[0m Consider using \033[0;32mmemory_search\033[0m for context"
    echo ""
fi
