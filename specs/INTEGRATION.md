# Integration Recommendations: Gemini CLI & Antigravity

## Overview

This document provides concrete recommendations for integrating the senior-level coding agent architecture with Gemini CLI and Antigravity environments.

---

## 1. Integration with Gemini CLI

### 1.1 File Structure

```
project-root/
├── .gemini/
│   ├── config.yaml              # Gemini CLI configuration
│   ├── system_prompt.md         # Custom system prompt
│   └── workflows/               # Workflow definitions
├── .agent/
│   ├── memory/
│   │   ├── semantic/
│   │   ├── procedural/
│   │   └── episodic/
│   ├── mcp/
│   │   └── config.json
│   └── state/
└── mcp-servers/                 # Custom MCP implementations
    ├── memory/
    ├── repo/
    └── test/
```

### 1.2 Configuration

```yaml
# .gemini/config.yaml
version: "1.0"

# Use custom system prompt
system_prompt_file: ".gemini/system_prompt.md"

# MCP server connections
mcp_servers:
  - name: "@memory"
    command: "node mcp-servers/memory/server.js"
    args: ["--storage", ".agent/memory/"]
    
  - name: "@repo"
    command: "node mcp-servers/repo/server.js"
    args: ["--cache-ttl", "300"]
    
  - name: "@test"
    command: "node mcp-servers/test/server.js"
    args: ["--config", "package.json"]

# Memory integration
memory:
  enabled: true
  auto_search: true
  storage_path: ".agent/memory/"

# Workflows
workflows_directory: ".gemini/workflows/"
```

### 1.3 MCP Server Implementation

Each MCP server follows the standard MCP protocol:

```typescript
// mcp-servers/memory/server.ts
import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";

const server = new Server({
  name: "memory",
  version: "1.0.0",
});

// Define tools
server.setRequestHandler("tools/list", async () => ({
  tools: [
    {
      name: "memory_write",
      description: "Persist a piece of knowledge to long-term memory...",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["semantic", "procedural", "episodic"] },
          category: { type: "string" },
          title: { type: "string" },
          content: { type: "string" },
          // ...
        },
        required: ["type", "category", "title", "content"],
      },
    },
    // ... other tools
  ],
}));

// Handle tool calls
server.setRequestHandler("tools/call", async (request) => {
  const { name, arguments: args } = request.params;
  
  switch (name) {
    case "memory_write":
      return await writeMemory(args);
    case "memory_search":
      return await searchMemory(args);
    // ...
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

### 1.4 Workflow Definition Example

```markdown
<!-- .gemini/workflows/fix-bug.md -->
---
description: How to diagnose and fix a bug
---

1. Understand the bug report
   - What is the expected behavior?
   - What is the actual behavior?
   - How to reproduce?

2. Search memory for similar issues
   // turbo
   - Check if this pattern was seen before

3. Locate relevant code
   - Find the file(s) involved
   - Understand the current implementation

4. Identify the root cause
   - Form a hypothesis
   - Verify with debugging or logging

5. Implement the fix
   - Make minimal necessary changes
   - Follow existing patterns

6. Verify the fix
   // turbo
   - Run relevant tests
   - Check for regression

7. Record learnings
   - If this was a non-obvious issue, log it
```

---

## 2. Integration with Antigravity

### 2.1 Leveraging Existing Systems

Antigravity already provides:
- Knowledge Items (KIs) for persistent knowledge
- Conversation history and summaries
- Artifact system for generated content
- Workflow support

**Key insight**: Don't recreate, integrate.

### 2.2 Memory MCP ↔ Knowledge Items

The Memory MCP should read/write Antigravity's Knowledge Items:

```typescript
// Memory MCP integration with Antigravity KIs
class MemoryMCP {
  private kiPath = "/Users/{user}/.gemini/antigravity/knowledge";
  
  async writeMemory(params: MemoryWriteParams): Promise<void> {
    const kiPath = path.join(
      this.kiPath,
      slugify(params.title),
    );
    
    // Create KI structure
    await fs.mkdir(path.join(kiPath, "artifacts"), { recursive: true });
    
    // Write metadata.json
    await fs.writeFile(
      path.join(kiPath, "metadata.json"),
      JSON.stringify({
        summary: params.title,
        category: params.category,
        type: params.type,
        created: new Date().toISOString(),
        confidence: params.confidence || 0.8,
        tags: params.tags || [],
      }, null, 2)
    );
    
    // Write content artifact
    await fs.writeFile(
      path.join(kiPath, "artifacts", "content.md"),
      params.content
    );
  }
  
  async searchMemory(params: MemorySearchParams): Promise<MemoryItem[]> {
    // Use existing KI search mechanisms
    const allKIs = await this.listKIs();
    
    // Filter and rank by relevance
    return allKIs
      .filter(ki => this.matchesQuery(ki, params.query))
      .sort((a, b) => this.relevanceScore(b, params.query) - this.relevanceScore(a, params.query))
      .slice(0, params.limit || 5);
  }
}
```

### 2.3 Conversation History as Episodic Memory

Leverage conversation logs for episodic memory:

```typescript
// Accessing conversation context
async function getRelevantEpisodicContext(query: string): Promise<Context[]> {
  const convPath = "/Users/{user}/.gemini/antigravity/brain";
  
  // Get conversation summaries (already available in Antigravity)
  const conversations = await fs.readdir(convPath);
  
  // Search conversation logs for relevant context
  const relevantConvs = await Promise.all(
    conversations.map(async convId => {
      const overviewPath = path.join(convPath, convId, ".system_generated/logs/overview.txt");
      const overview = await fs.readFile(overviewPath, "utf-8");
      return { convId, overview, relevance: computeRelevance(overview, query) };
    })
  );
  
  return relevantConvs
    .filter(c => c.relevance > 0.5)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 3);
}
```

### 2.4 System Prompt Integration

Replace the default system prompt section with the minimal cognitive prompt:

**Option A: Prompt File**
```
# ~/.gemini/antigravity/system_prompt.md
<include>./agent-architecture/prompts/system.txt</include>
```

**Option B: Inline in Config**
Configure Antigravity to use custom system instructions while preserving tool definitions and other context.

### 2.5 Decision Log Integration

Use the artifact system for decision logs:

```typescript
// Store decisions as artifacts in the conversation
async function logDecision(decision: Decision): Promise<void> {
  const artifactPath = path.join(
    conversationPath,
    "artifacts",
    `decision_${Date.now()}.md`
  );
  
  const content = `
# Decision: ${decision.title}

## Context
${decision.context}

## Decision
${decision.decision}

## Alternatives Considered
${decision.alternatives.map(a => `- ${a}`).join("\n")}

## Rationale
${decision.rationale}

## Risks
${decision.risks.map(r => `- ${r}`).join("\n")}

## Related Files
${decision.related_files.map(f => `- \`${f}\``).join("\n")}

---
Logged: ${new Date().toISOString()}
`;
  
  await fs.writeFile(artifactPath, content);
}
```

---

## 3. Implementation Roadmap

### Phase 1: Core Foundation (Week 1-2)

1. **Deploy minimal system prompt**
   - Create `.gemini/system_prompt.md` or equivalent
   - Test cognitive behavior without MCPs

2. **Implement Memory MCP (basic)**
   - Write: Save to KI structure
   - Search: Simple keyword matching
   - Read: Retrieve by ID

3. **Create Repository Inspector MCP**
   - `understand`: Analyze file context
   - Integrate with existing search tools

### Phase 2: Verification Layer (Week 3-4)

4. **Implement Test MCP**
   - `run`: Execute tests with scope
   - `lint`: Run linting
   - Integrate with project's test framework

5. **Add Decision Log MCP**
   - `log`: Record decisions
   - `query`: Search past decisions

6. **Enhance memory search**
   - Add embedding-based similarity
   - Implement relevance ranking

### Phase 3: Workflow Layer (Week 5-6)

7. **Implement Workflow MCP**
   - Create structured workflows
   - Track step completion
   - Enable checkpointing

8. **Add Documentation MCP**
   - Search project docs
   - Query dependency documentation

9. **Integrate with Gemini workflows**
   - Map MCP workflows to `.gemini/workflows/`

### Phase 4: Optimization (Ongoing)

10. **Memory optimization**
    - Implement confidence decay
    - Add memory clustering
    - Enable cross-project memory

11. **Proactive suggestions**
    - Auto-suggest relevant memories
    - Warn about past issues

---

## 4. Configuration Templates

### 4.1 Minimal Setup

For quick start with core functionality:

```yaml
# .gemini/config.yaml (minimal)
system_prompt_file: ".gemini/system_prompt.md"

mcp_servers:
  - name: "@memory"
    command: "npx @agent/memory-mcp"
    args: ["--storage", ".agent/memory/"]
```

### 4.2 Full Setup

For complete functionality:

```yaml
# .gemini/config.yaml (full)
version: "1.0"
system_prompt_file: ".gemini/system_prompt.md"

mcp_servers:
  - name: "@memory"
    command: "node ./mcp-servers/dist/memory.js"
    args: ["--storage", ".agent/memory/", "--ki-integration", "true"]
    
  - name: "@repo"
    command: "node ./mcp-servers/dist/repo.js"
    args: ["--cache-ttl", "300", "--deep-analysis", "true"]
    
  - name: "@test"
    command: "node ./mcp-servers/dist/test.js"
    args: ["--framework", "jest", "--config", "jest.config.js"]
    
  - name: "@docs"
    command: "node ./mcp-servers/dist/docs.js"
    args: ["--sources", "./docs,./node_modules"]
    
  - name: "@decisions"
    command: "node ./mcp-servers/dist/decisions.js"
    args: ["--storage", ".agent/memory/episodic/decisions/"]
    
  - name: "@workflow"
    command: "node ./mcp-servers/dist/workflow.js"
    args: ["--state-dir", ".agent/state/"]

memory:
  enabled: true
  auto_search_on_new_file: true
  write_confidence_threshold: 0.7
  max_search_results: 5
  
  semantic:
    max_items: 500
    decay_days: 90
    
  procedural:
    max_items: 100
    
  episodic:
    max_items: 1000
    retain_days: 365

workflows_directory: ".gemini/workflows/"
```

---

## 5. Testing and Validation

### 5.1 Agent Behavior Tests

Create test scenarios to validate agent behavior:

```typescript
// tests/agent-behavior.test.ts
describe("Agent Cognitive Behavior", () => {
  test("should read before write", async () => {
    const result = await agent.process("Add logging to AuthService");
    
    // Verify read operations came before write
    const actions = result.toolCalls.map(c => c.name);
    const firstWrite = actions.findIndex(a => a.includes("write") || a.includes("replace"));
    const lastRead = actions.lastIndexOf(a => a.includes("read") || a.includes("view"));
    
    expect(firstWrite).toBeGreaterThan(lastRead);
  });
  
  test("should verify after changes", async () => {
    const result = await agent.process("Fix the failing test");
    
    // Verify test was run after fix
    const actions = result.toolCalls;
    const fixAction = actions.find(a => a.name.includes("replace"));
    const testAction = actions.find(a => a.name === "test_run");
    
    expect(testAction).toBeDefined();
    expect(actions.indexOf(testAction)).toBeGreaterThan(actions.indexOf(fixAction));
  });
  
  test("should search memory on new area", async () => {
    const result = await agent.process("Refactor the payment service");
    
    // Verify memory was searched
    const memorySearch = result.toolCalls.find(a => a.name === "memory_search");
    expect(memorySearch).toBeDefined();
  });
});
```

### 5.2 Memory Quality Tests

```typescript
describe("Memory Quality", () => {
  test("should not write trivial memories", async () => {
    const result = await agent.process("Add a console log to debug");
    
    const memoryWrites = result.toolCalls.filter(a => a.name === "memory_write");
    expect(memoryWrites.length).toBe(0);
  });
  
  test("should write significant learnings", async () => {
    const result = await agent.process(
      "The tests were failing because of timezone issues in the CI environment"
    );
    
    // After discovering and fixing a non-obvious issue
    const memoryWrites = result.toolCalls.filter(a => a.name === "memory_write");
    expect(memoryWrites.length).toBeGreaterThan(0);
    expect(memoryWrites[0].arguments.type).toBe("episodic");
  });
});
```

---

## 6. Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Agent doesn't use memory | MCP not connected | Check MCP server is running |
| Memory searches return nothing | No memories written yet | Seed with project conventions |
| Agent writes too much to memory | Low confidence threshold | Increase `write_confidence_threshold` |
| Tests not running | Wrong test command | Update `test_command` in config |
| Slow responses | Deep analysis on every file | Reduce `cache-ttl`, use `shallow` depth |

### Debug Mode

Enable verbose logging for debugging:

```yaml
# .gemini/config.yaml
debug:
  enabled: true
  log_tool_calls: true
  log_memory_operations: true
  log_mcp_communication: true
```
