# Research Synthesis: Autonomous AI Coding Agents

## Executive Summary

This document synthesizes research on designing autonomous AI agents for software development, with a focus on CLI/IDE-like environments (Gemini CLI, Antigravity, Devin, SWE-agent, etc.). The goal is to inform the design of a minimal but powerful system prompt, accompanied by custom MCPs (Model Context Protocol), for a senior-level coding AI agent.

---

## 1. Core Architecture Patterns for AI Agents

### 1.1 The Three Pillars of Effective Agents

Based on the Prompt Engineering Guide and industry research, effective AI agents require three fundamental capabilities:

1. **Planning & Reasoning**
   - Task decomposition via Chain-of-Thought (CoT)
   - Self-reflection on past actions
   - Adaptive learning to improve decisions
   - Critical analysis of progress
   - Tree of Thoughts (ToT) for complex multi-path reasoning

2. **Tool Utilization**
   - Code interpreters and execution environments
   - Search and retrieval utilities
   - File system operations
   - Version control integration
   - Testing and validation tools

3. **Memory Systems**
   - **Short-term (Working) Memory**: In-context learning, immediate state
   - **Long-term Memory**: Persistent knowledge via external storage (vector stores, databases)
   - **Hybrid Memory**: Combination for long-range reasoning and experience accumulation

### 1.2 Shallow vs. Deep Agents

**Shallow Agents** (what to avoid):
- Break down on long, multi-step problems
- Lack persistent planning structures
- Limited context management
- Ad-hoc reasoning inside single context window

**Deep Agents** (what to build):
- Strategically plan, remember, and delegate
- Maintain structured task plans that can be updated, retried, recovered
- Use orchestrator-subagent architecture
- Implement persistent storage for intermediate work
- Heavy emphasis on context engineering and verification

### 1.3 Orchestrator-Subagent Architecture

Key insight: One big agent with long context is **not enough**.

**Benefits:**
- Separation of concerns (planning vs. execution)
- Improved reliability (clean, focused responsibilities)
- Model selection flexibility (reasoning LLM for planning, fast LLM for execution)
- Efficient context management through separation

**Example Architecture:**
```
┌─────────────────────────────────────────────────────┐
│                   ORCHESTRATOR                       │
│  (Planning, Coordination, Decision Making)          │
│  Model: High-capability reasoning LLM               │
└─────────────────────────┬───────────────────────────┘
                          │
     ┌────────────────────┼────────────────────┐
     ▼                    ▼                    ▼
┌─────────┐         ┌─────────┐         ┌─────────┐
│ Search  │         │ Coder   │         │ Tester  │
│ Agent   │         │ Agent   │         │ Agent   │
└─────────┘         └─────────┘         └─────────┘
```

---

## 2. Memory Architecture for Coding Agents

### 2.1 Memory Types (Cognitive Framework)

| Type | Description | Implementation | Use Case |
|------|-------------|----------------|----------|
| **Semantic** | Concepts, knowledge, conventions | Vector DB + knowledge items | Project patterns, user preferences, coding standards |
| **Procedural** | Workflows, processes, how-to | Structured documents | How to deploy, test patterns, CI/CD workflows |
| **Episodic** | Past experiences, decisions, outcomes | Event log with outcomes | "Last time we tried X, it failed because Y" |

### 2.2 Memory Operations

A senior-level coding agent needs parsimonious memory operations:

**Write Conditions:**
- New domain-specific knowledge discovered
- User explicitly states a preference or convention
- A decision was made with significant reasoning
- An error occurred and was resolved (lesson learned)
- A complex workflow was successfully completed

**Read Conditions:**
- Starting work on a new area of the codebase
- Encountering a pattern that might have been seen before
- Before making architectural decisions
- When debugging issues similar to past problems

### 2.3 Memory Format Recommendations

```yaml
# Semantic Memory (Knowledge Item)
type: semantic
category: [architecture|convention|preference|pattern]
content: "structured JSON or markdown"
confidence: 0.0-1.0
source_context: "conversation_id or commit reference"
created: "timestamp"
accessed: "timestamp"
accessed_count: int

# Procedural Memory (Workflow)
type: procedural  
name: "deployment_workflow"
steps: [ordered list of steps]
prerequisites: [conditions that must be met]
outcomes: [expected results]

# Episodic Memory (Decision Log)
type: episodic
decision: "what was decided"
context: "why this came up"
alternatives_considered: [list]
outcome: "what happened"
lessons: "what was learned"
timestamp: "when"
```

---

## 3. Planning Patterns for Senior-Level Behavior

### 3.1 The "Never Code Immediately" Principle

A senior engineer's workflow:
1. **Understand** - Clarify requirements, ask questions
2. **Research** - Inspect context, read docs, understand constraints
3. **Plan** - Propose specific approach before execution
4. **Execute** - Minimal, surgical changes
5. **Verify** - Test, lint, validate
6. **Document** - Record decisions and lessons

### 3.2 Planning Techniques

**ReAct Pattern** (Reasoning + Acting):
```
Thought: I need to understand the current state of the codebase
Action: read_directory(path)
Observation: [directory contents]
Thought: I see the structure, now I need to understand the specific file
Action: view_file(path)
Observation: [file contents]
... continue until task is complete
```

**Reflexion Pattern** (Self-Improvement):
- Actor generates trajectory
- Evaluator scores output
- Self-reflection generates improvement cues
- Next iteration incorporates feedback

### 3.3 Task Decomposition Strategy

For complex coding tasks:
1. Break into independent subtasks
2. Identify dependencies between subtasks
3. Prioritize based on: a) blocking dependencies, b) risk/complexity, c) information needs
4. Execute subtasks with verification gates
5. Integrate with validation

---

## 4. Context Engineering Principles

### 4.1 The Shift from Prompt Engineering to Context Engineering

Context engineering encompasses:
- System prompts that define agent behavior
- Task constraints that guide decision-making
- Tool descriptions that clarify when/how to use functions
- Memory management for tracking state
- Error handling patterns for robust execution

### 4.2 Key Principles

1. **Eliminate Ambiguity**
   - Bad: "Perform research on the given topic"
   - Good: "Break down the query into 3-5 specific search subtasks, execute searches, document findings, synthesize into report"

2. **Make Expectations Explicit**
   - Required vs optional actions
   - Quality standards
   - Output formats
   - Decision-making criteria

3. **Implement Observability**
   - Log all agent decisions and reasoning
   - Track state changes
   - Record tool calls and outcomes
   - Capture errors and edge cases

4. **Balance Flexibility and Constraints**
   - Strict: Predictable but less adaptable
   - Flexible: Adaptable but potentially inconsistent
   - Choose based on use case

### 4.3 Layered Context Architecture

```
┌───────────────────────────────────────┐
│        SYSTEM LAYER                   │
│  Core identity, capabilities, values  │
├───────────────────────────────────────┤
│        TASK LAYER                     │
│  Current objective, constraints       │
├───────────────────────────────────────┤
│        TOOL LAYER                     │
│  Available tools, usage guidelines    │
├───────────────────────────────────────┤
│        MEMORY LAYER                   │
│  Historical context, learnings        │
└───────────────────────────────────────┘
```

---

## 5. Self-Critique and Validation Patterns

### 5.1 Verification Mechanisms

1. **Pre-execution verification**
   - Does the plan make sense?
   - Are there edge cases not considered?
   - What could go wrong?

2. **Post-execution verification**
   - Did the change work as expected?
   - Are tests passing?
   - Does the code lint clean?
   - Are there performance implications?

3. **Self-reflection questions**
   - "Is this the minimal change to solve the problem?"
   - "Am I introducing technical debt?"
   - "What would a senior engineer critique about this?"

### 5.2 LLM-as-Judge Pattern

Use the agent itself or a separate verifier to:
- Evaluate code quality
- Check for potential bugs
- Assess alignment with requirements
- Identify missing edge cases

---

## 6. Anti-Patterns to Avoid

### 6.1 Prompt Pitfalls

| Anti-Pattern | Description | Solution |
|--------------|-------------|----------|
| **Over-constraint** | Too many rigid rules | Use guidelines with flexibility |
| **Under-specification** | Vague instructions | Be explicit about expectations |
| **Tool redundancy** | Describing tools already available | Reference tools implicitly |
| **Context overload** | Too much information upfront | Layer information, retrieve on-demand |
| **Ignoring errors** | No error handling guidance | Include recovery patterns |

### 6.2 Agent Behavior Pitfalls

- **Coding before understanding**: Always inspect context first
- **Making assumptions**: Ask for clarification when uncertain
- **Ignoring tests**: Always verify changes
- **Overcomplicating**: Prefer minimal changes
- **Forgetting context**: Reference memory before decisions

---

## 7. MCP (Model Context Protocol) Design Patterns

### 7.1 Principles of Good MCP Design

1. **Single Responsibility**: Each MCP handles one domain
2. **Rich Descriptions**: Tools are self-documenting
3. **Graceful Failures**: Return informative errors
4. **Stateless Operations**: MCPs don't maintain internal state
5. **Composability**: MCPs work together seamlessly

### 7.2 Recommended MCP Categories for Coding Agents

| MCP | Purpose | Key Primitives |
|-----|---------|----------------|
| **Memory** | Long-term storage | read, write, search, forget |
| **Repository** | Code inspection | explore, search_code, get_context |
| **Execution** | Run code/tests | run_test, run_lint, execute_script |
| **Documentation** | Access docs | search_docs, get_api_reference |
| **Decision Log** | Track choices | log_decision, query_decisions |
| **Workflow** | Process management | get_workflow, update_status |

---

## 8. Integration Recommendations

### 8.1 For Gemini CLI / Antigravity

Key integration points:
- Use existing tool infrastructure (don't redefine)
- Layer additional MCPs for specialized capabilities
- Maintain compatibility with conversation history
- Leverage existing memory systems (Knowledge Items)

### 8.2 Minimal Prompt + Powerful MCP Strategy

**Prompt Handles:**
- Agent identity and cognitive style
- Decision-making principles
- When to use reasoning patterns
- Quality standards and values

**MCPs Handle:**
- Implementation details
- Tool descriptions
- State management
- Retrieval operations
- Execution primitives

---

## 9. Research References

### Primary Sources
- DAIR.AI Prompt Engineering Guide (comprehensive prompting techniques)
- Deep Agents concept (DAIR.AI, LangChain Labs, Claude Code)
- ReAct: Synergizing Reasoning and Acting (Yao et al., 2022)
- Reflexion: Language Agents with Verbal Reinforcement (Shinn et al., 2023)
- Tree of Thoughts (Yao et al., 2023; Long, 2023)

### Additional Context
- Context Engineering best practices (DAIR.AI Agents course)
- Function Calling in AI Agents (modern tool integration)
- RAG for knowledge-intensive tasks
- Self-RAG: Learning to Retrieve, Generate, and Critique

---

## 10. Key Takeaways for Implementation

1. **Cognitive over Operational**: The prompt defines HOW the agent thinks, not WHAT tools exist
2. **Memory is Parsimonious**: Write rarely, read intelligently
3. **Plan Before Act**: Always understand before changing
4. **Verify Everything**: Tests, lints, self-critique
5. **Externalize Complexity**: Push operational logic to MCPs
6. **Stay Minimal**: The shortest effective prompt wins
7. **Observe and Iterate**: Context engineering is continuous
