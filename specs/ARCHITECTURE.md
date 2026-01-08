# Architecture: Senior-Level Coding Agent

## System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              USER REQUEST                                     │
└──────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         SYSTEM PROMPT (Cognitive Core)                        │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  • Identity & Values                                                    │  │
│  │  • Cognitive Style (how to think, not what tools exist)                │  │
│  │  • Decision Principles (when to plan, when to execute, when to verify) │  │
│  │  • Quality Standards (minimal changes, always verify, ask when unsure) │  │
│  │  • Memory Strategy (when to read/write memory)                         │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
       ┌────────────────┐   ┌────────────────┐   ┌────────────────┐
       │   EXISTING     │   │    CUSTOM      │   │   CONTEXT      │
       │    TOOLS       │   │     MCPs       │   │   MEMORY       │
       │   (unchanged)  │   │   (new layer)  │   │   (persistent) │
       └────────────────┘   └────────────────┘   └────────────────┘
              │                     │                     │
              │    ┌────────────────┼────────────────┐    │
              │    │                │                │    │
              ▼    ▼                ▼                ▼    ▼
       ┌─────────────┐   ┌─────────────┐   ┌─────────────────────┐
       │ File System │   │  @memory    │   │ Knowledge Items     │
       │ Terminal    │   │  @repo      │   │ Conversation History│
       │ Search      │   │  @test      │   │ Decision Logs       │
       │ Browser     │   │  @docs      │   │ Workflow States     │
       │ etc.        │   │  @decisions │   │                     │
       └─────────────┘   │  @workflow  │   └─────────────────────┘
                         └─────────────┘
```

---

## Design Principles

### 1. Separation of Concerns

| Layer | Responsibility | Location |
|-------|---------------|----------|
| **Cognitive** | How to think, decide, prioritize | System Prompt |
| **Operational** | How to execute specific actions | MCPs + Existing Tools |
| **Persistent** | What has been learned | Memory System |

### 2. Minimal Prompt, Maximum Intelligence

The system prompt should be:
- **Short** (~500-800 words maximum)
- **Stable** (rarely needs updates)
- **Generic** (works across different projects)
- **Cognitive** (defines thinking, not procedures)

The MCPs should:
- **Carry operational intelligence**
- **Self-document** through rich tool descriptions
- **Handle edge cases** and error recovery
- **Evolve independently** from the prompt

### 3. Implicit Tool Usage

The prompt does NOT list tools. Instead, it establishes principles:

❌ **Wrong**: "You have access to: view_file, run_command, memory_write..."

✅ **Right**: "Always understand before changing. When facing uncertainty, search memory first. After every change, verify with tests."

The agent infers which tools to use from the principles + tool descriptions.

---

## Cognitive Flow

### Phase 1: Understand

```
User Request
    │
    ▼
┌─────────────────────────────────────────┐
│     CLARIFY INTENT                       │
│  • Is the request clear?                │
│  • What is the actual goal?             │
│  • What constraints exist?              │
│  • Ask questions if uncertain           │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│     CHECK MEMORY                         │
│  • Have I seen this before?             │
│  • Are there relevant conventions?      │
│  • Past decisions for similar contexts? │
│  • Known patterns or gotchas?           │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│     INSPECT CONTEXT                      │
│  • What does the codebase look like?    │
│  • What patterns are already used?      │
│  • What are the dependencies?           │
│  • What tests exist?                    │
└─────────────────────────────────────────┘
```

### Phase 2: Plan

```
┌─────────────────────────────────────────┐
│     FORMULATE APPROACH                   │
│  • What is the minimal change?          │
│  • What are the steps?                  │
│  • What could go wrong?                 │
│  • What needs verification?             │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│     PRESENT PLAN                         │
│  • Explain the approach                 │
│  • Highlight risks                      │
│  • Get confirmation if significant      │
└─────────────────────────────────────────┘
```

### Phase 3: Execute

```
┌─────────────────────────────────────────┐
│     MAKE CHANGES                         │
│  • One logical change at a time         │
│  • Follow existing patterns             │
│  • Document non-obvious decisions       │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│     VERIFY                               │
│  • Run tests                            │
│  • Check linting                        │
│  • Validate type safety                 │
│  • Self-critique: Is this right?        │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│     ITERATE IF NEEDED                    │
│  • If tests fail, diagnose and fix      │
│  • If issues found, address them        │
│  • Repeat until clean                   │
└─────────────────────────────────────────┘
```

### Phase 4: Learn

```
┌─────────────────────────────────────────┐
│     RECORD LEARNINGS                     │
│  • Was there a new pattern learned?     │
│  • Was a significant decision made?     │
│  • Did something unexpected happen?     │
│  • Is there a convention to remember?   │
└─────────────────────────────────────────┘
```

---

## Memory Architecture

### Storage Hierarchy

```
.agent/
├── memory/
│   ├── semantic/           # Knowledge, conventions, patterns
│   │   ├── architecture/
│   │   ├── conventions/
│   │   └── preferences/
│   ├── procedural/         # Workflows, how-to guides
│   │   └── workflows/
│   └── episodic/           # Decision log, lessons learned
│       └── decisions/
├── mcp/
│   └── config.json         # MCP configuration
└── state/
    └── active_workflow.json
```

### Memory Decision Matrix

| Trigger | Memory Type | Action |
|---------|-------------|--------|
| New convention discovered | Semantic | Write |
| User expresses preference | Semantic | Write |
| Complex workflow completed | Procedural | Write |
| Significant decision made | Episodic | Log decision |
| Error resolved after investigation | Episodic | Log lesson |
| Starting new code area | All | Search/Read |
| Implementing unfamiliar pattern | Semantic + Procedural | Search |
| Making architectural choice | Episodic | Query past decisions |

### Memory Parsimony Rules

1. **Don't write obvious things** - The agent can figure out common patterns
2. **Don't duplicate** - Search before writing
3. **Prefer high-value memories** - Focus on things that save future time
4. **Update over create** - Enhance existing memories when possible
5. **Expire stale memories** - Mark outdated info as deprecated

---

## MCP Integration Model

### Tool Resolution

When the agent needs to perform an action:

1. **Check implicit context** - Does the conversation provide enough?
2. **Check memory** - Do I know this already?
3. **Use appropriate tool** - Could be existing or MCP

### MCP Layering

```
           User Intent
                │
                ▼
    ┌───────────────────────┐
    │  High-Level MCPs      │  @memory, @decisions, @workflow
    │  (Strategy Layer)     │  
    └───────────────────────┘
                │
                ▼
    ┌───────────────────────┐
    │  Domain MCPs          │  @repo, @test, @docs
    │  (Intelligence Layer) │  
    └───────────────────────┘
                │
                ▼
    ┌───────────────────────┐
    │  Base Tools           │  file, terminal, search, browser
    │  (Primitive Layer)    │  
    └───────────────────────┘
```

### Example Flow

**User**: "Fix the failing test in auth.test.js"

```
1. Agent thinks: "I need to understand why this test fails"
   
2. Check memory (@memory:search)
   → No relevant past issues found
   
3. Understand context (@repo:understand path=auth.test.js)
   → Returns: test structure, related files, patterns
   
4. Run failing test (@test:run scope=file target=auth.test.js)
   → Returns: failure details, stack trace
   
5. Agent analyzes, forms hypothesis
   
6. Check pattern (@repo:search_patterns query="error handling in auth")
   → Returns: how similar issues were handled
   
7. Make fix (existing: replace_file_content)
   
8. Verify (@test:run scope=file target=auth.test.js)
   → Returns: PASS
   
9. Record if learned something new (@memory:write)
   → Only if this was a non-obvious gotcha
```

---

## Integration Points

### With Gemini CLI / Antigravity

| Component | Integration Approach |
|-----------|---------------------|
| Existing Tools | Keep unchanged, MCPs complement |
| Knowledge Items | Memory MCP reads/writes as KIs |
| Conversation History | Reference for memory decisions |
| System Prompt | Replace with minimal cognitive prompt |
| Workflows | Use Workflow MCP for complex tasks |

### Configuration

```json
// .agent/mcp/config.json
{
  "mcps": {
    "@memory": {
      "enabled": true,
      "storage": ".agent/memory/",
      "max_items_per_type": 500
    },
    "@repo": {
      "enabled": true,
      "cache_ttl_seconds": 300
    },
    "@test": {
      "enabled": true,
      "test_command": "npm test",
      "lint_command": "npm run lint"
    },
    "@docs": {
      "enabled": true,
      "sources": ["./docs/", "node_modules/"]
    },
    "@decisions": {
      "enabled": true,
      "storage": ".agent/memory/episodic/decisions/"
    },
    "@workflow": {
      "enabled": true,
      "storage": ".agent/state/"
    }
  },
  "memory": {
    "auto_search_on_new_file": true,
    "write_confidence_threshold": 0.7,
    "max_search_results": 5
  }
}
```

---

## Success Metrics

### Agent Quality

| Metric | Target | Measurement |
|--------|--------|-------------|
| Understand before code | 100% | Never edits without first reading |
| Test after change | 100% | Always verifies changes |
| Minimal changes | High | Diff size relative to task scope |
| Memory hit rate | >30% | Useful memories found when searched |
| Decision log completeness | >80% | Significant decisions recorded |

### User Experience

| Metric | Target |
|--------|--------|
| Time to first useful action | < 30 seconds |
| Questions asked when needed | Yes |
| Unnecessary questions | No |
| Clear explanations of changes | Yes |
| Recovery from errors | Graceful |

---

## Evolution Path

### Phase 1: Foundation
- Minimal system prompt
- Memory MCP (basic)
- Repository Inspector MCP

### Phase 2: Verification
- Test & Validation MCP
- Decision Log MCP
- Enhanced memory search

### Phase 3: Scale
- Workflow MCP
- Documentation MCP
- Memory optimization

### Phase 4: Intelligence
- Semantic clustering of memories
- Proactive memory suggestions
- Pattern recognition across projects
