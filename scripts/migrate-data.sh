#!/bin/bash
OLD_DATA="$HOME/.gemini/antigravity/agent-data"
NEW_DATA="$HOME/.eclipse-agent"

if [ -d "$OLD_DATA" ] && [ ! -d "$NEW_DATA/profiles" ]; then
    echo "Migrating data from $OLD_DATA to $NEW_DATA..."
    mkdir -p "$NEW_DATA"
    cp -r "$OLD_DATA/profiles" "$NEW_DATA/" 2>/dev/null || true
    cp -r "$OLD_DATA/.cache" "$NEW_DATA/" 2>/dev/null || true
    echo "Migration complete!"
else
    if [ ! -d "$OLD_DATA" ]; then
        echo "No old data found at $OLD_DATA"
    else
        echo "Data already migrated (profiles exist in $NEW_DATA)"
    fi
fi
