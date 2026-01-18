#!/bin/bash
# Eclipse Hook: Pre-Edit Warning
# Warns about critical files before editing
# Receives JSON input via stdin with tool_input containing file_path

# Read JSON from stdin
INPUT=$(cat)

# Extract file_path from tool_input using node (more reliable than jq dependency)
FILE_PATH=$(echo "$INPUT" | node -e "
const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
console.log(data.tool_input?.file_path || data.tool_input?.filePath || '');
" 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
    exit 0
fi

# Critical patterns that warrant extra caution
CRITICAL_PATTERNS=(
    "auth" "login" "password" "secret" "token" "key"
    "config" "env" ".env" "settings"
    "security" "permission" "role" "admin"
    "payment" "billing" "stripe" "paypal"
    "database" "migration" "schema"
    "api" "endpoint" "route"
    "middleware" "interceptor"
)

# Check if file matches critical patterns
FILE_LOWER=$(echo "$FILE_PATH" | tr '[:upper:]' '[:lower:]')
IS_CRITICAL=false

for pattern in "${CRITICAL_PATTERNS[@]}"; do
    if [[ "$FILE_LOWER" == *"$pattern"* ]]; then
        IS_CRITICAL=true
        break
    fi
done

if [ "$IS_CRITICAL" = true ]; then
    FILENAME=$(basename "$FILE_PATH")
    echo ""
    echo -e "\033[1;33m[Eclipse Warning]\033[0m Critical file detected: $FILENAME"
    echo -e "  \033[0;36m->\033[0m Consider using \033[0;32mfile_context_scan\033[0m first"
    echo -e "  \033[0;36m->\033[0m Check \033[0;32mmemory_search\033[0m for past issues"
    echo ""
fi
