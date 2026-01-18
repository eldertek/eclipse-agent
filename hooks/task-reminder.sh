#!/bin/bash
# Eclipse Hook: Task Reminder
# Reminds to convene boardroom and save learnings before finishing

YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${MAGENTA}  🏢 BOARDROOM REMINDER${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${YELLOW}Before ending this session, consider:${NC}"
echo ""
echo -e "  ${GREEN}1.${NC} ${BOLD}Convene the Board${NC} -> Use subagent ${MAGENTA}boardroom${NC}"
echo -e "     ${CYAN}\"What's the strategic priority? What should we ship next?\"${NC}"
echo ""
echo -e "  ${GREEN}2.${NC} Save learnings -> ${YELLOW}memory_save${NC}"
echo -e "  ${GREEN}3.${NC} Log decisions -> ${YELLOW}decision_log${NC}"
echo -e "  ${GREEN}4.${NC} Quality check -> subagents ${YELLOW}hunter${NC} or ${YELLOW}reviewer${NC}"
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
