# Loop MCP Server

A Model Context Protocol (MCP) server that prevents an AI agent from stopping prematurely by requiring explicit approval before ending a response.

## Philosophy

An agent should only stop when:
- The task is genuinely complete
- User input is needed
- A blocking error occurred
- Clarification is required
- The user explicitly requested stop

It should NOT stop when:
- It "feels" like it has done enough
- The work summary is vague
- Changes haven't been verified
- Confidence is low

## Installation

```bash
cd agent-architecture/mcp/loop-server
npm install
```

## Usage

### With Antigravity

Add to `~/.gemini/antigravity/mcp_config.json`:

```json
{
  "mcpServers": {
    "loop": {
      "command": "node",
      "args": [
        "/absolute/path/to/agent-architecture/mcp/loop-server/index.js"
      ]
    }
  }
}
```

### Direct Testing

```bash
node index.js
```

The server communicates via stdio using the MCP protocol.

## Tool: `should_continue`

The single tool provided by this MCP.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_summary` | string | ✓ | Brief summary of the assigned task |
| `work_done` | string | ✓ | Detailed list of actions taken |
| `work_remaining` | string | | Honest assessment of remaining work |
| `stopping_reason` | enum | ✓ | Why the agent wants to stop |
| `confidence` | number | | 0-1 confidence that stopping is correct |
| `verification_done` | boolean | | Whether changes were verified |

### Stopping Reasons

- `task_complete` - The task is fully done
- `waiting_for_user` - User input is needed
- `error_cannot_proceed` - A blocking error occurred
- `need_clarification` - The request is unclear
- `user_requested_stop` - User explicitly asked to stop

### Responses

**Approved** (✅ APPROVED TO STOP):
- Agent may end response
- Conditions are genuinely met

**Denied** (❌ DO NOT STOP - CONTINUE WORKING):
- Agent must continue
- Issues are listed to address
- Agent should call again after making progress

## Example Scenarios

### Task Complete Without Verification

```json
{
  "task_summary": "Fix auth bug",
  "work_done": "Modified the code",
  "stopping_reason": "task_complete",
  "confidence": 0.7,
  "verification_done": false
}
```

**Response**: ❌ DO NOT STOP
- No verification done
- Confidence too low (< 80%)
- Work summary too short

### Properly Complete Task

```json
{
  "task_summary": "Fix authentication bug",
  "work_done": "1. Analyzed auth.js. 2. Found session token issue. 3. Fixed validation logic. 4. Added unit tests. 5. All tests pass.",
  "stopping_reason": "task_complete",
  "confidence": 0.95,
  "verification_done": true
}
```

**Response**: ✅ APPROVED TO STOP

### Waiting for User

```json
{
  "task_summary": "Implement new feature",
  "work_done": "Analyzed requirements, identified two possible approaches",
  "stopping_reason": "waiting_for_user"
}
```

**Response**: ✅ APPROVED TO STOP (needs user input)

## Integration with System Prompt

The system prompt should include:

```markdown
## Loop Control (CRITICAL)

**You MUST call the `should_continue` tool before ending ANY response.**

When you think you're done:
1. Call `should_continue` with your task summary, work done, and stopping reason
2. If approved: you may end your response
3. If not approved: continue working on the identified issues
4. Call again when you've made progress
```

## License

MIT
