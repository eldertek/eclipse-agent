# MCP Specifications for Senior-Level Coding Agent

## Overview

This document specifies the Model Context Protocol (MCP) servers designed to power a senior-level autonomous coding agent. These MCPs externalize operational complexity from the system prompt, allowing the prompt to focus purely on cognitive behavior.

**Design Principle**: MCPs carry the intelligence about *how* to do things; the prompt defines *when* and *why* to do them.

---

## 1. Memory MCP (`@memory`)

### Purpose
Manage persistent long-term memory across sessions, distinguishing semantic knowledge, procedural workflows, and episodic decisions.

### Resources

| Resource URI | Description |
|--------------|-------------|
| `memory://semantic/list` | List all semantic memory items |
| `memory://procedural/list` | List all workflow items |
| `memory://episodic/list` | List recent decision log entries |
| `memory://stats` | Memory usage statistics |

### Tools

#### `memory_write`
Write a new memory item to the appropriate store.

```typescript
{
  name: "memory_write",
  description: "Persist a piece of knowledge, workflow, or decision to long-term memory. Use sparingly - only for genuinely important learnings that will be valuable in future sessions.",
  parameters: {
    type: {
      type: "string",
      enum: ["semantic", "procedural", "episodic"],
      description: "Type of memory: semantic (knowledge/conventions), procedural (workflows), episodic (decisions/lessons)"
    },
    category: {
      type: "string", 
      description: "Category within memory type (e.g., 'architecture', 'user_preference', 'debugging_lesson')"
    },
    title: {
      type: "string",
      description: "Short, searchable title for this memory"
    },
    content: {
      type: "string",
      description: "The memory content in markdown format"
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Tags for semantic search"
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Confidence in this memory (0.0-1.0)"
    }
  },
  required: ["type", "category", "title", "content"]
}
```

#### `memory_search`
Search across memory stores using semantic similarity.

```typescript
{
  name: "memory_search",
  description: "Search long-term memory for relevant knowledge before making decisions or implementing changes. Always check memory before assuming you need to figure something out from scratch.",
  parameters: {
    query: {
      type: "string",
      description: "Natural language search query"
    },
    memory_types: {
      type: "array",
      items: { type: "string", enum: ["semantic", "procedural", "episodic"] },
      description: "Which memory types to search (defaults to all)"
    },
    limit: {
      type: "integer",
      default: 5,
      description: "Maximum number of results"
    }
  },
  required: ["query"]
}
```

#### `memory_retrieve`
Retrieve a specific memory item by ID.

```typescript
{
  name: "memory_retrieve",
  description: "Get the full content of a specific memory item by its ID",
  parameters: {
    memory_id: {
      type: "string",
      description: "The unique identifier of the memory item"
    }
  },
  required: ["memory_id"]
}
```

#### `memory_update`
Update an existing memory item with new information.

```typescript
{
  name: "memory_update", 
  description: "Update an existing memory with corrections or additional context. Use when you learn something new about a topic already in memory.",
  parameters: {
    memory_id: {
      type: "string",
      description: "The ID of the memory to update"
    },
    content: {
      type: "string",
      description: "Updated content (replaces previous)"
    },
    reason: {
      type: "string",
      description: "Why this update is being made"
    }
  },
  required: ["memory_id", "content", "reason"]
}
```

#### `memory_forget`
Mark a memory as obsolete (soft delete).

```typescript
{
  name: "memory_forget",
  description: "Mark a memory as no longer relevant. Use when you discover information is outdated or incorrect.",
  parameters: {
    memory_id: {
      type: "string"
    },
    reason: {
      type: "string",
      description: "Why this memory is being deprecated"
    }
  },
  required: ["memory_id", "reason"]
}
```

### Implementation Notes
- Store memories in structured files under `.agent/memory/`
- Use embeddings for semantic search
- Track access patterns to surface frequently-used memories
- Implement confidence decay for old, unaccessed memories

---

## 2. Repository Inspector MCP (`@repo`)

### Purpose
Provide deep understanding of the codebase structure, patterns, and context without requiring the agent to manually navigate.

### Resources

| Resource URI | Description |
|--------------|-------------|
| `repo://structure` | High-level project structure |
| `repo://readme` | Project README content |
| `repo://conventions` | Detected coding conventions |
| `repo://recent-changes` | Recent git commits |

### Tools

#### `repo_understand`
Get a comprehensive understanding of a code area.

```typescript
{
  name: "repo_understand",
  description: "Before modifying any code, use this to understand the context: what the file does, its relationships, patterns used, and relevant conventions.",
  parameters: {
    path: {
      type: "string",
      description: "File or directory path to understand"
    },
    depth: {
      type: "string",
      enum: ["shallow", "deep"],
      default: "shallow",
      description: "shallow = summary, deep = full analysis with dependencies"
    }
  },
  required: ["path"]
}
```

**Returns:**
```yaml
file: "path/to/file.ts"
purpose: "Handles user authentication flows"
patterns:
  - "Repository pattern for data access"
  - "Async/await throughout"
  - "Error handling with custom exceptions"
imports_from:
  - "./types.ts"  
  - "./database.ts"
imported_by:
  - "./routes/auth.ts"
  - "./middleware/session.ts"
conventions_observed:
  - "camelCase for functions"
  - "Interface prefix with I"
test_file: "./auth.test.ts"
last_modified: "2024-01-15"
last_modified_by: "andre"
```

#### `repo_search_patterns`
Find code patterns across the repository.

```typescript
{
  name: "repo_search_patterns",
  description: "Search for how something is done elsewhere in the codebase. Use before implementing something to ensure consistency with existing patterns.",
  parameters: {
    pattern_query: {
      type: "string",
      description: "Natural language description of the pattern to find (e.g., 'error handling in API routes', 'database connection setup')"
    }
  },
  required: ["pattern_query"]
}
```

#### `repo_find_similar`
Find files similar to a given file.

```typescript
{
  name: "repo_find_similar",
  description: "Find files that are structurally or functionally similar to a given file. Useful for understanding conventions and patterns.",
  parameters: {
    file_path: {
      type: "string"
    }
  },
  required: ["file_path"]
}
```

#### `repo_get_dependencies`
Understand dependency relationships.

```typescript
{
  name: "repo_get_dependencies",
  description: "Get what a file depends on and what depends on it. Critical before modifying shared code.",
  parameters: {
    file_path: {
      type: "string"
    },
    direction: {
      type: "string",
      enum: ["imports", "imported_by", "both"],
      default: "both"
    }
  },
  required: ["file_path"]
}
```

---

## 3. Test & Validation MCP (`@test`)

### Purpose
Run tests, linting, and static analysis to validate changes. The agent should never assume changes work - always verify.

### Resources

| Resource URI | Description |
|--------------|-------------|
| `test://status` | Current test suite status |
| `test://coverage` | Code coverage summary |
| `test://recent-failures` | Recent test failures |

### Tools

#### `test_run`
Run tests for specific scope.

```typescript
{
  name: "test_run",
  description: "Run tests to verify changes work correctly. ALWAYS run after making code changes.",
  parameters: {
    scope: {
      type: "string",
      enum: ["all", "file", "function", "affected"],
      description: "all = full suite, file = single file, function = single test, affected = tests that use changed files"
    },
    target: {
      type: "string",
      description: "File path or function name (required for file/function scope)"
    }
  },
  required: ["scope"]
}
```

#### `test_lint`
Run linting and static analysis.

```typescript
{
  name: "test_lint",
  description: "Run linter to check for style violations and potential issues. Run before committing changes.",
  parameters: {
    files: {
      type: "array",
      items: { type: "string" },
      description: "Files to lint (empty = all changed files)"
    },
    fix: {
      type: "boolean",
      default: false,
      description: "Attempt to auto-fix issues"
    }
  }
}
```

#### `test_typecheck`
Run type checking.

```typescript
{
  name: "test_typecheck",
  description: "Run type checker to ensure type safety. Essential for TypeScript/typed Python projects.",
  parameters: {
    files: {
      type: "array",
      items: { type: "string" },
      description: "Files to check (empty = full project)"
    }
  }
}
```

#### `test_suggest`
Suggest tests for code changes.

```typescript
{
  name: "test_suggest",
  description: "Generate suggestions for tests that should be written or updated for given code changes.",
  parameters: {
    changed_files: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["changed_files"]
}
```

---

## 4. Documentation MCP (`@docs`)

### Purpose
Access project documentation, API references, and external documentation for libraries.

### Resources

| Resource URI | Description |
|--------------|-------------|
| `docs://project` | Project documentation index |
| `docs://api` | API documentation |
| `docs://changelog` | Project changelog |

### Tools

#### `docs_search`
Search documentation.

```typescript
{
  name: "docs_search",
  description: "Search project and library documentation. Use before implementing something unfamiliar.",
  parameters: {
    query: {
      type: "string",
      description: "Natural language search query"
    },
    scope: {
      type: "string",
      enum: ["project", "dependencies", "all"],
      default: "all"
    }
  },
  required: ["query"]
}
```

#### `docs_get_api`
Get API reference for a specific component.

```typescript
{
  name: "docs_get_api",
  description: "Get detailed API documentation for a specific function, class, or module.",
  parameters: {
    name: {
      type: "string",
      description: "Component name (e.g., 'lodash.debounce', 'React.useState')"
    }
  },
  required: ["name"]
}
```

---

## 5. Decision Log MCP (`@decisions`)

### Purpose
Track architectural decisions, technical choices, and their outcomes. Essential for learning from experience.

### Tools

#### `decision_log`
Log a significant technical decision.

```typescript
{
  name: "decision_log",
  description: "Record a significant technical decision for future reference. Use when making choices that affect architecture, patterns, or approach.",
  parameters: {
    decision: {
      type: "string",
      description: "What was decided"
    },
    context: {
      type: "string",
      description: "Why this decision was needed"
    },
    alternatives: {
      type: "array",
      items: { type: "string" },
      description: "Other options that were considered"
    },
    rationale: {
      type: "string",
      description: "Why this option was chosen over alternatives"
    },
    risks: {
      type: "array",
      items: { type: "string" },
      description: "Known risks or downsides of this decision"
    },
    related_files: {
      type: "array",
      items: { type: "string" },
      description: "Files affected by this decision"
    }
  },
  required: ["decision", "context", "rationale"]
}
```

#### `decision_query`
Query past decisions.

```typescript
{
  name: "decision_query",
  description: "Search past decisions for similar contexts. Use before making similar decisions to learn from history.",
  parameters: {
    query: {
      type: "string",
      description: "Natural language query about the decision context"
    },
    related_to: {
      type: "string",
      description: "Filter by related file path"
    }
  },
  required: ["query"]
}
```

#### `decision_update_outcome`
Update a decision with its observed outcome.

```typescript
{
  name: "decision_update_outcome",
  description: "Record the actual outcome of a past decision. Essential for learning from experience.",
  parameters: {
    decision_id: {
      type: "string"
    },
    outcome: {
      type: "string",
      enum: ["successful", "problematic", "needs_revision"],
      description: "How the decision turned out"
    },
    notes: {
      type: "string",
      description: "Details about what happened"
    },
    lessons: {
      type: "array",
      items: { type: "string" },
      description: "Key lessons learned"
    }
  },
  required: ["decision_id", "outcome"]
}
```

---

## 6. Workflow MCP (`@workflow`)

### Purpose
Manage structured workflows for complex multi-step tasks. Provides checkpointing and recovery.

### Tools

#### `workflow_create`
Create a new workflow for a complex task.

```typescript
{
  name: "workflow_create",
  description: "Create a structured workflow for complex, multi-step tasks. Use for anything with more than 3 steps.",
  parameters: {
    name: {
      type: "string",
      description: "Workflow name"
    },
    goal: {
      type: "string", 
      description: "What this workflow achieves"
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          dependencies: { 
            type: "array",
            items: { type: "string" }
          },
          verification: { type: "string" }
        }
      },
      description: "Ordered steps with dependencies and verification criteria"
    }
  },
  required: ["name", "goal", "steps"]
}
```

#### `workflow_status`
Get current workflow status.

```typescript
{
  name: "workflow_status",
  description: "Get the status of the current active workflow",
  parameters: {
    workflow_id: {
      type: "string"
    }
  }
}
```

#### `workflow_update_step`
Update step status.

```typescript
{
  name: "workflow_update_step",
  description: "Update the status of a workflow step",
  parameters: {
    workflow_id: { type: "string" },
    step_id: { type: "string" },
    status: {
      type: "string",
      enum: ["pending", "in_progress", "completed", "failed", "skipped"]
    },
    notes: {
      type: "string",
      description: "Notes about completion or failure"
    }
  },
  required: ["workflow_id", "step_id", "status"]
}
```

---

## Implementation Priority

1. **Phase 1 (Core)**: Memory MCP, Repository Inspector MCP
2. **Phase 2 (Validation)**: Test & Validation MCP
3. **Phase 3 (Learning)**: Decision Log MCP
4. **Phase 4 (Scale)**: Workflow MCP, Documentation MCP

---

## Integration with Gemini CLI / Antigravity

These MCPs are designed to complement, not replace, existing tools:

- **Existing tools** (file operations, terminal, search) remain unchanged
- **MCPs add intelligence layers** on top of basic operations
- **Memory MCP** integrates with Antigravity's Knowledge Item system
- **Configuration** lives in `.agent/mcp/` directory
- **State** stored in `.agent/memory/` and `.agent/decisions/`
