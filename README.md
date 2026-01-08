# Senior-Level Coding Agent Architecture

A minimal but powerful system for building autonomous AI coding agents with long-term intelligent memory, senior-level behavior, and self-critique capabilities.

## Philosophy

> "The prompt defines HOW the agent thinks, not WHAT tools exist."

This architecture separates concerns:
- **System Prompt**: Cognitive behavior (short, stable, generic)
- **MCPs**: Operational intelligence (modular, rich, evolvable)
- **Memory**: Persistent knowledge (semantic, procedural, episodic)

## Quick Start

### 1. System Prompt (Already Installed)

The system prompt is located at:
```
~/.gemini/GEMINI.md
```

### 2. Loop MCP (Already Configured)

The loop MCP prevents the agent from stopping prematurely:
```
~/.gemini/antigravity/mcp_config.json
```

### 3. Verify Installation

```bash
# Test the MCP server
cd agent-architecture/mcp/loop-server
npm start
```

## Repository Structure

```
agent-architecture/
├── research/
│   └── SYNTHESIS.md           # Research findings and patterns
├── specs/
│   ├── ARCHITECTURE.md        # System architecture overview
│   ├── MCP_SPECIFICATIONS.md  # Detailed MCP definitions
│   └── INTEGRATION.md         # Gemini CLI / Antigravity integration
├── prompts/
│   ├── SYSTEM_PROMPT.md       # Documented prompt with rationale
│   └── system.txt             # Clean prompt ready to use
├── mcp/
│   └── loop-server/           # ✅ IMPLEMENTED - Loop MCP server
│       ├── index.js           # MCP server implementation
│       ├── package.json       # Node.js dependencies
│       └── README.md          # Usage documentation
└── README.md
```

## Core Documents

### 1. Research Synthesis
[`research/SYNTHESIS.md`](research/SYNTHESIS.md)

Comprehensive research on AI agent architecture including:
- Three pillars of effective agents
- Shallow vs Deep agents
- Memory architecture patterns
- Planning techniques (ReAct, Reflexion, ToT)
- Context engineering principles
- Anti-patterns to avoid

### 2. System Prompt
[`prompts/system.txt`](prompts/system.txt)

A ~500-word cognitive prompt that establishes:
- Core principles (Understand → Plan → Execute → Verify → Learn)
- Decision framework
- Cognitive style
- Quality standards

**Key features:**
- Does NOT list tools (MCPs self-document)
- Does NOT contain procedures (pushes to MCPs)
- IS stable across projects
- IS minimal and focused

### 3. MCP Specifications
[`specs/MCP_SPECIFICATIONS.md`](specs/MCP_SPECIFICATIONS.md)

Six specialized MCPs:
| MCP | Purpose |
|-----|---------|
| `@memory` | Long-term knowledge persistence |
| `@repo` | Deep codebase understanding |
| `@test` | Verification and validation |
| `@docs` | Documentation access |
| `@decisions` | Technical decision logging |
| `@workflow` | Multi-step task management |

### 4. Architecture Overview
[`specs/ARCHITECTURE.md`](specs/ARCHITECTURE.md)

System design including:
- Component relationships
- Cognitive flow
- Memory decision matrix
- MCP integration model
- Success metrics

### 5. Integration Guide
[`specs/INTEGRATION.md`](specs/INTEGRATION.md)

Concrete recommendations for:
- Gemini CLI configuration
- Antigravity integration
- Knowledge Item compatibility
- Implementation roadmap
- Testing strategies

## Key Principles

### 1. Understand Before Acting
The agent never modifies code it hasn't read. It searches memory, inspects context, and understands patterns before making changes.

### 2. Plan Before Executing
For non-trivial tasks, the agent formulates a clear approach first. It prefers minimal, surgical changes over large rewrites.

### 3. Verify After Changing
The agent always runs tests after modifications, checks for lint errors, and self-critiques its solutions.

### 4. Learn and Remember
When genuine insights are discovered, they're recorded. But memory is parsimonious—only truly valuable learnings are persisted.

## Memory Architecture

Three types of memory for different purposes:

| Type | Purpose | Example |
|------|---------|---------|
| **Semantic** | Knowledge, conventions, patterns | "This project uses camelCase" |
| **Procedural** | Workflows, how-to guides | "To deploy: npm run build && deploy.sh" |
| **Episodic** | Decisions, lessons learned | "Tried approach X, failed because Y" |

Memory is parsimonious:
- Write rarely (only significant insights)
- Read intelligently (before making decisions)
- Update over create (enhance existing memories)
- Expire over accumulate (deprecate stale info)

## Implementation Priority

1. **Phase 1**: System prompt + Memory MCP + Repo MCP
2. **Phase 2**: Test MCP + Decision Log MCP
3. **Phase 3**: Workflow MCP + Documentation MCP
4. **Phase 4**: Memory optimization + cross-project learning

## Compatibility

Designed for integration with:
- **Gemini CLI**: As custom MCP servers + system prompt
- **Antigravity**: Leveraging Knowledge Items + conversation history
- **Other LLM CLI tools**: Generic MCP protocol compliance

## References

Based on research from:
- DAIR.AI Prompt Engineering Guide
- Deep Agents concept (DAIR.AI, LangChain Labs, Claude Code)
- ReAct: Synergizing Reasoning and Acting
- Reflexion: Language Agents with Verbal Reinforcement
- Tree of Thoughts frameworks

## License

MIT

---

*Built for developers who want an AI agent that codes like a senior engineer: thoughtful, careful, and continuously learning.*
