#!/usr/bin/env node

/**
 * Agent Core MCP Server v2
 * 
 * Features:
 * - Loop Control: Prevents premature stopping
 * - Planning: Phase-based work management (understand → plan → execute → verify)
 * - Task Tracking: Checkpoints and progress logging
 * - Long-Term Memory: Persistent knowledge with SEMANTIC SEARCH
 * - Multi-Profile: Isolated memory per project + global shared memory
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const BASE_DATA_DIR = path.join(process.env.HOME, ".gemini", "antigravity", "agent-data");
const EMBEDDING_DIM = 384; // all-MiniLM-L6-v2 dimension
const CACHE_DIR = path.join(BASE_DATA_DIR, ".cache", "models");

// ═══════════════════════════════════════════════════════════════════════════
// PROFILE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

function getProfileName() {
    // Priority: ENV > CWD-based detection > "global"
    if (process.env.ECLIPSE_PROFILE) {
        return sanitizeProfileName(process.env.ECLIPSE_PROFILE);
    }

    // Try to detect project from CWD
    const cwd = process.cwd();

    // Check for common project indicators
    const projectIndicators = [
        'package.json',
        'Cargo.toml',
        'go.mod',
        'pyproject.toml',
        'requirements.txt',
        '.git'
    ];

    for (const indicator of projectIndicators) {
        if (fs.existsSync(path.join(cwd, indicator))) {
            // Use directory name as profile
            return sanitizeProfileName(path.basename(cwd));
        }
    }

    return "global";
}

function sanitizeProfileName(name) {
    return name.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 50);
}

function getProfileDir(profile) {
    const dir = path.join(BASE_DATA_DIR, "profiles", profile);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

const CURRENT_PROFILE = getProfileName();
const PROFILE_DIR = getProfileDir(CURRENT_PROFILE);
const GLOBAL_DIR = getProfileDir("global");

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE SETUP (per-profile + global)
// ═══════════════════════════════════════════════════════════════════════════

function initDatabase(dbPath) {
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");

    db.exec(`
    -- Long-term memory table with embedding support
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('semantic', 'procedural', 'episodic')),
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      confidence REAL DEFAULT 1.0,
      embedding BLOB,
      source_context TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_accessed TEXT NOT NULL,
      access_count INTEGER DEFAULT 0
    );

    -- Task/Session tracking
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      current_phase TEXT DEFAULT 'understand',
      task_summary TEXT,
      checkpoints TEXT DEFAULT '[]',
      ended_at TEXT
    );

    -- Decision log
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      decision TEXT NOT NULL,
      context TEXT NOT NULL,
      rationale TEXT NOT NULL,
      alternatives TEXT,
      outcome TEXT,
      created_at TEXT NOT NULL
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
    CREATE INDEX IF NOT EXISTS idx_decisions_session ON decisions(session_id);
  `);

    return db;
}

// Initialize databases
const profileDb = initDatabase(path.join(PROFILE_DIR, "memory.db"));
const globalDb = initDatabase(path.join(GLOBAL_DIR, "memory.db"));

// ═══════════════════════════════════════════════════════════════════════════
// EMBEDDING ENGINE (Lazy-loaded)
// ═══════════════════════════════════════════════════════════════════════════

let embeddingPipeline = null;
let embeddingReady = false;
let embeddingError = null;

async function initEmbeddings() {
    if (embeddingPipeline) return embeddingPipeline;
    if (embeddingError) return null;

    try {
        // Dynamic import for ESM module
        const { pipeline, env } = await import("@huggingface/transformers");

        // Configure cache directory
        env.cacheDir = CACHE_DIR;
        fs.mkdirSync(CACHE_DIR, { recursive: true });

        // Load the model (will download on first use, ~80MB)
        embeddingPipeline = await pipeline(
            "feature-extraction",
            "Xenova/all-MiniLM-L6-v2",
            { quantized: true }
        );

        embeddingReady = true;
        console.error("[eclipse] Embedding model loaded: all-MiniLM-L6-v2");
        return embeddingPipeline;
    } catch (err) {
        embeddingError = err;
        console.error("[eclipse] Embedding not available, using keyword search:", err.message);
        return null;
    }
}

async function generateEmbedding(text) {
    const pipe = await initEmbeddings();
    if (!pipe) return null;

    try {
        const output = await pipe(text, { pooling: "mean", normalize: true });
        // Convert to Float32Array
        return new Float32Array(output.data);
    } catch (err) {
        console.error("[eclipse] Embedding error:", err.message);
        return null;
    }
}

function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dotProduct = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
    }
    return dotProduct; // Already normalized
}

function embeddingToBuffer(embedding) {
    if (!embedding) return null;
    return Buffer.from(embedding.buffer);
}

function bufferToEmbedding(buffer) {
    if (!buffer) return null;
    return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

// ═══════════════════════════════════════════════════════════════════════════
// PREPARED STATEMENTS
// ═══════════════════════════════════════════════════════════════════════════

function prepareStatements(db) {
    return {
        insertMemory: db.prepare(`
      INSERT INTO memories (id, type, category, title, content, tags, confidence, embedding, source_context, created_at, updated_at, last_accessed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
        getAllMemories: db.prepare(`SELECT * FROM memories`),
        getMemoriesByType: db.prepare(`
      SELECT * FROM memories 
      WHERE type IN (SELECT value FROM json_each(?))
    `),
        getMemoryById: db.prepare(`SELECT * FROM memories WHERE id = ?`),
        updateMemory: db.prepare(`UPDATE memories SET content = ?, tags = ?, confidence = ?, embedding = ?, updated_at = ? WHERE id = ?`),
        deleteMemory: db.prepare(`DELETE FROM memories WHERE id = ?`),
        incrementAccess: db.prepare(`UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?`),

        // Fallback keyword search
        searchKeyword: db.prepare(`
      SELECT * FROM memories 
      WHERE (type IN (SELECT value FROM json_each(?)) OR ? = '[]')
        AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)
      ORDER BY access_count DESC, last_accessed DESC
      LIMIT ?
    `),

        insertSession: db.prepare(`INSERT INTO sessions (id, started_at, task_summary) VALUES (?, ?, ?)`),
        getActiveSession: db.prepare(`SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`),
        updateSession: db.prepare(`UPDATE sessions SET current_phase = ?, checkpoints = ?, task_summary = COALESCE(?, task_summary) WHERE id = ?`),
        endSession: db.prepare(`UPDATE sessions SET ended_at = ? WHERE id = ?`),

        insertDecision: db.prepare(`INSERT INTO decisions (id, session_id, decision, context, rationale, alternatives, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`),
        searchDecisions: db.prepare(`SELECT * FROM decisions WHERE decision LIKE ? OR context LIKE ? ORDER BY created_at DESC LIMIT ?`),
    };
}

const profileStmts = prepareStatements(profileDb);
const globalStmts = prepareStatements(globalDb);

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function generateId() {
    return crypto.randomBytes(8).toString("hex");
}

function now() {
    return new Date().toISOString();
}

// ═══════════════════════════════════════════════════════════════════════════
// SEMANTIC SEARCH
// ═══════════════════════════════════════════════════════════════════════════

async function semanticSearch(query, options = {}) {
    const { memoryTypes = ["semantic", "procedural", "episodic"], limit = 5, scope = "all" } = options;

    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query);

    // Collect memories from relevant databases
    let allMemories = [];

    if (scope === "all" || scope === "profile") {
        const typesJson = JSON.stringify(memoryTypes);
        const profileMemories = memoryTypes.length === 3
            ? profileStmts.getAllMemories.all()
            : profileStmts.getMemoriesByType.all(typesJson);
        allMemories.push(...profileMemories.map(m => ({ ...m, source: "profile" })));
    }

    if (scope === "all" || scope === "global") {
        const typesJson = JSON.stringify(memoryTypes);
        const globalMemories = memoryTypes.length === 3
            ? globalStmts.getAllMemories.all()
            : globalStmts.getMemoriesByType.all(typesJson);
        allMemories.push(...globalMemories.map(m => ({ ...m, source: "global" })));
    }

    // Filter by type if not all
    if (memoryTypes.length < 3) {
        allMemories = allMemories.filter(m => memoryTypes.includes(m.type));
    }

    // If no embeddings available, fall back to keyword search
    if (!queryEmbedding) {
        const searchPattern = `%${query}%`;
        const typesJson = JSON.stringify(memoryTypes);

        let results = [];
        if (scope === "all" || scope === "profile") {
            results.push(...profileStmts.searchKeyword.all(typesJson, typesJson.length === 3 ? "[]" : typesJson, searchPattern, searchPattern, searchPattern, limit).map(m => ({ ...m, source: "profile" })));
        }
        if (scope === "all" || scope === "global") {
            results.push(...globalStmts.searchKeyword.all(typesJson, typesJson.length === 3 ? "[]" : typesJson, searchPattern, searchPattern, searchPattern, limit).map(m => ({ ...m, source: "global" })));
        }

        return results.slice(0, limit);
    }

    // Calculate similarity scores
    const scored = allMemories.map(memory => {
        const memoryEmbedding = bufferToEmbedding(memory.embedding);
        const similarity = memoryEmbedding ? cosineSimilarity(queryEmbedding, memoryEmbedding) : 0;

        // Boost by access count (slight preference for frequently used memories)
        const accessBoost = Math.min(memory.access_count * 0.01, 0.1);

        return {
            ...memory,
            similarity: similarity + accessBoost,
        };
    });

    // Sort by similarity and return top results
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════════════
// MCP SERVER
// ═══════════════════════════════════════════════════════════════════════════

const server = new McpServer({
    name: "agent-core",
    version: "2.0.0",
});

// ───────────────────────────────────────────────────────────────────────────
// LOOP CONTROL
// ───────────────────────────────────────────────────────────────────────────

server.tool(
    "should_continue",
    `CRITICAL: You MUST call this tool EVERY TIME before you consider stopping or ending your response.

This tool evaluates whether you should continue working or if stopping is justified.

When to call this tool:
- Before writing your final message
- When you think you've completed the task
- When you're unsure if there's more to do
- When you feel the urge to stop

The tool will analyze your work and either:
- APPROVE: You may stop, the task is genuinely complete
- CONTINUE: There's more work to do, keep going

Never stop without calling this tool first.`,
    {
        task_summary: z.string().describe("Brief summary of what you were asked to do"),
        work_done: z.string().describe("Detailed list of actions you have taken"),
        work_remaining: z.string().optional().describe("Honest assessment: is there anything left to do?"),
        stopping_reason: z.enum([
            "task_complete",
            "waiting_for_user",
            "error_cannot_proceed",
            "need_clarification",
            "user_requested_stop"
        ]).describe("Why you want to stop"),
        confidence: z.number().min(0).max(1).optional().describe("How confident are you that stopping is correct? (0-1)"),
        verification_done: z.boolean().optional().describe("Have you verified your changes work?")
    },
    async (args) => {
        const analysis = analyzeStoppingRequest(args);

        // Also update session if exists
        const session = profileStmts.getActiveSession.get();
        if (session && args.stopping_reason === "task_complete" && !analysis.shouldContinue) {
            profileStmts.endSession.run(now(), session.id);
        }

        return {
            content: [{ type: "text", text: analysis.response }]
        };
    }
);

function analyzeStoppingRequest(args) {
    const { task_summary, work_done, work_remaining, stopping_reason, confidence, verification_done } = args;

    const mustContinue = [];

    if (stopping_reason === "task_complete" && !verification_done) {
        mustContinue.push("You marked the task as complete but haven't verified your changes. Run tests or validate your work first.");
    }

    if (confidence !== undefined && confidence < 1.0 && stopping_reason === "task_complete") {
        mustContinue.push(`Your confidence is only ${(confidence * 100).toFixed(0)}%. You must be 100% confident to stop.`);
    }

    if (stopping_reason === "task_complete" && work_remaining && work_remaining.trim().length > 10) {
        mustContinue.push(`You've identified remaining work: "${work_remaining}". Complete this before stopping.`);
    }

    if (work_done && work_done.split(/[.,\n]/).filter(s => s.trim()).length < 2) {
        mustContinue.push("Your work summary is very short. Have you really completed the task, or just started?");
    }

    const canStop = ["waiting_for_user", "need_clarification", "user_requested_stop"];

    if (canStop.includes(stopping_reason)) {
        return {
            shouldContinue: false,
            response: `✅ APPROVED TO STOP\n\nReason: ${stopping_reason}\n\nYou may end your response. This is a legitimate stopping point because you need input from the user before proceeding.`
        };
    }

    if (stopping_reason === "error_cannot_proceed") {
        return {
            shouldContinue: false,
            response: `✅ APPROVED TO STOP (with error)\n\nYou've encountered a blocking error. Make sure you've:\n1. Clearly explained the error to the user\n2. Suggested potential solutions or next steps\n3. Asked for guidance if needed\n\nYou may end your response after providing this information.`
        };
    }

    if (stopping_reason === "task_complete") {
        if (mustContinue.length > 0) {
            return {
                shouldContinue: true,
                response: `❌ DO NOT STOP - CONTINUE WORKING\n\nIssues found:\n${mustContinue.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}\n\nAddress these issues before attempting to stop again. Call this tool again when you've made progress.`
            };
        }

        return {
            shouldContinue: false,
            response: `✅ APPROVED TO STOP\n\nTask appears genuinely complete:\n- Task: ${task_summary}\n- Work done: ${work_done}\n- Verification: ${verification_done ? 'Yes' : 'Not specified'}\n- Confidence: ${confidence !== undefined ? (confidence * 100).toFixed(0) + '%' : 'Not specified'}\n\nYou may end your response. Good work!`
        };
    }

    return {
        shouldContinue: true,
        response: `❌ CONTINUE WORKING\n\nUnknown stopping reason. Please provide a valid reason:\n- task_complete: The task is fully done\n- waiting_for_user: You need user input\n- need_clarification: The request is unclear\n- error_cannot_proceed: A blocking error occurred\n- user_requested_stop: User explicitly asked to stop\n\nContinue working or call this tool with a valid reason.`
    };
}

// ───────────────────────────────────────────────────────────────────────────
// PLANNING & TASK TRACKING
// ───────────────────────────────────────────────────────────────────────────

server.tool(
    "task_start",
    `Begin tracking a new task. Call this at the start of significant work.

This creates a session that tracks your progress through phases:
- understand: Reading, researching, clarifying
- plan: Formulating approach, identifying risks
- execute: Making changes
- verify: Testing, validating, reviewing

Current profile: ${CURRENT_PROFILE}`,
    {
        task_summary: z.string().describe("What you're about to work on")
    },
    async (args) => {
        const id = generateId();
        const timestamp = now();

        // End any existing active session
        const active = profileStmts.getActiveSession.get();
        if (active) {
            profileStmts.endSession.run(timestamp, active.id);
        }

        profileStmts.insertSession.run(id, timestamp, args.task_summary);

        return {
            content: [{
                type: "text",
                text: `🚀 Task session started\n\n**Session ID**: ${id}\n**Profile**: ${CURRENT_PROFILE}\n**Task**: ${args.task_summary}\n**Current Phase**: understand\n\nRemember the workflow: understand → plan → execute → verify`
            }]
        };
    }
);

server.tool(
    "phase_transition",
    `Transition to a new phase of work. Use this to structure your approach.

Phases:
- understand: You're reading code, clarifying requirements, researching
- plan: You've understood and are now planning the approach
- execute: Plan is ready, you're making changes
- verify: Changes made, you're testing and validating`,
    {
        to_phase: z.enum(["understand", "plan", "execute", "verify"]).describe("The phase you're transitioning to"),
        phase_summary: z.string().describe("Summary of what you accomplished/learned in the previous phase"),
        blockers: z.string().optional().describe("Any blockers or concerns discovered")
    },
    async (args) => {
        const session = profileStmts.getActiveSession.get();

        if (!session) {
            return {
                content: [{
                    type: "text",
                    text: `⚠️ No active session. Call task_start first to begin tracking.`
                }]
            };
        }

        const checkpoints = JSON.parse(session.checkpoints || "[]");
        checkpoints.push({
            phase: session.current_phase,
            completed_at: now(),
            summary: args.phase_summary,
            blockers: args.blockers
        });

        profileStmts.updateSession.run(args.to_phase, JSON.stringify(checkpoints), null, session.id);

        const phaseEmoji = {
            understand: "🔍",
            plan: "📋",
            execute: "⚡",
            verify: "✅"
        };

        return {
            content: [{
                type: "text",
                text: `${phaseEmoji[args.to_phase]} Transitioned to: **${args.to_phase}**\n\n**Previous phase summary**: ${args.phase_summary}${args.blockers ? `\n\n⚠️ **Blockers noted**: ${args.blockers}` : ""}\n\n**Total checkpoints**: ${checkpoints.length}`
            }]
        };
    }
);

server.tool(
    "checkpoint",
    `Log a significant progress point within the current phase.

Use this to:
- Record important discoveries
- Note decisions made
- Track incremental progress on long tasks`,
    {
        note: z.string().describe("What you accomplished or discovered"),
        importance: z.enum(["low", "medium", "high"]).optional().describe("How significant is this checkpoint?")
    },
    async (args) => {
        const session = profileStmts.getActiveSession.get();

        if (!session) {
            return {
                content: [{
                    type: "text",
                    text: `⚠️ No active session. Call task_start first.`
                }]
            };
        }

        const checkpoints = JSON.parse(session.checkpoints || "[]");
        checkpoints.push({
            phase: session.current_phase,
            checkpoint_at: now(),
            note: args.note,
            importance: args.importance || "medium"
        });

        profileStmts.updateSession.run(session.current_phase, JSON.stringify(checkpoints), null, session.id);

        const importanceEmoji = { low: "📝", medium: "📌", high: "⭐" };

        return {
            content: [{
                type: "text",
                text: `${importanceEmoji[args.importance || "medium"]} Checkpoint recorded\n\n**Phase**: ${session.current_phase}\n**Note**: ${args.note}`
            }]
        };
    }
);

// ───────────────────────────────────────────────────────────────────────────
// LONG-TERM MEMORY (with Semantic Search)
// ───────────────────────────────────────────────────────────────────────────

server.tool(
    "memory_save",
    `Save important knowledge to long-term memory for future sessions.

Memory types:
- semantic: Facts, conventions, architecture knowledge, preferences
- procedural: How to do things, workflows, patterns, best practices
- episodic: Past decisions, errors made, lessons learned

Scope:
- profile (default): Saved to current project (${CURRENT_PROFILE})
- global: Saved to shared memory across all projects

Be PARSIMONIOUS: only save what's genuinely useful for future work.`,
    {
        type: z.enum(["semantic", "procedural", "episodic"]).describe("Type of memory"),
        category: z.string().describe("Category (e.g., 'project-structure', 'debugging', 'api-patterns')"),
        title: z.string().describe("Brief, searchable title"),
        content: z.string().describe("The knowledge to remember"),
        tags: z.array(z.string()).optional().describe("Tags for search"),
        confidence: z.number().min(0).max(1).optional().describe("Confidence level (0.0-1.0), default 1.0"),
        scope: z.enum(["profile", "global"]).optional().describe("Where to save: profile (project-specific) or global (shared)")
    },
    async (args) => {
        const id = generateId();
        const timestamp = now();
        const tagsJson = JSON.stringify(args.tags || []);
        const scope = args.scope || "profile";
        const stmts = scope === "global" ? globalStmts : profileStmts;

        // Generate embedding for semantic search
        const textToEmbed = `${args.title} ${args.content} ${(args.tags || []).join(" ")}`;
        const embedding = await generateEmbedding(textToEmbed);
        const embeddingBuffer = embeddingToBuffer(embedding);

        try {
            stmts.insertMemory.run(
                id,
                args.type,
                args.category,
                args.title,
                args.content,
                tagsJson,
                args.confidence ?? 1.0,
                embeddingBuffer,
                null,
                timestamp,
                timestamp,
                timestamp
            );

            const embeddingStatus = embedding ? "✓ semantic search enabled" : "⚠ keyword search only";

            return {
                content: [{
                    type: "text",
                    text: `✅ Memory saved\n\n**ID**: ${id}\n**Type**: ${args.type}\n**Category**: ${args.category}\n**Title**: ${args.title}\n**Scope**: ${scope} (${scope === "global" ? "shared" : CURRENT_PROFILE})\n**Embedding**: ${embeddingStatus}\n\nThis knowledge is now available for future sessions.`
                }]
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: `❌ Failed to save memory: ${error.message}` }],
                isError: true
            };
        }
    }
);

server.tool(
    "memory_search",
    `Search long-term memory using semantic similarity.

This uses AI embeddings to find conceptually related memories, not just keyword matches.

ALWAYS check memory before:
- Making architectural decisions
- Implementing patterns that might exist elsewhere
- Debugging issues that might have been seen before
- Starting work on a new area of the codebase

Scope:
- all (default): Search both project and global memories
- profile: Only current project (${CURRENT_PROFILE})
- global: Only shared memories

This is your accumulated experience - use it!`,
    {
        query: z.string().describe("Natural language search query"),
        memory_types: z.array(z.enum(["semantic", "procedural", "episodic"])).optional().describe("Filter by memory types (defaults to all)"),
        limit: z.number().int().min(1).max(20).optional().describe("Maximum results (default 5)"),
        scope: z.enum(["all", "profile", "global"]).optional().describe("Where to search: all, profile, or global")
    },
    async (args) => {
        const types = args.memory_types || ["semantic", "procedural", "episodic"];
        const limit = args.limit || 5;
        const scope = args.scope || "all";

        try {
            const results = await semanticSearch(args.query, {
                memoryTypes: types,
                limit,
                scope
            });

            // Update access counts
            const timestamp = now();
            for (const r of results) {
                const stmts = r.source === "global" ? globalStmts : profileStmts;
                stmts.incrementAccess.run(timestamp, r.id);
            }

            if (results.length === 0) {
                return {
                    content: [{
                        type: "text",
                        text: `No memories found for: "${args.query}"\n\nThis might be new territory - proceed with research and consider saving your findings.`
                    }]
                };
            }

            const formatted = results.map((r, i) => {
                const tags = JSON.parse(r.tags || "[]");
                const similarityPct = r.similarity ? ` | **Match**: ${(r.similarity * 100).toFixed(0)}%` : "";
                return `### ${i + 1}. ${r.title}\n**Type**: ${r.type} | **Category**: ${r.category} | **Source**: ${r.source}${similarityPct}\n**Tags**: ${tags.join(", ") || "none"}\n\n${r.content}`;
            }).join("\n\n---\n\n");

            const searchType = embeddingReady ? "🧠 Semantic search" : "🔤 Keyword search";

            return {
                content: [{
                    type: "text",
                    text: `${searchType} found ${results.length} relevant memories:\n\n${formatted}`
                }]
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: `❌ Search failed: ${error.message}` }],
                isError: true
            };
        }
    }
);

server.tool(
    "memory_update",
    "Update an existing memory with new or corrected information",
    {
        memory_id: z.string().describe("The ID of the memory to update"),
        content: z.string().optional().describe("New content (if updating)"),
        tags: z.array(z.string()).optional().describe("New tags (if updating)"),
        confidence: z.number().min(0).max(1).optional().describe("Updated confidence level"),
        scope: z.enum(["profile", "global"]).optional().describe("Where the memory is stored")
    },
    async (args) => {
        // Try to find in profile first, then global
        let stmts = profileStmts;
        let existing = stmts.getMemoryById.get(args.memory_id);
        let scope = "profile";

        if (!existing) {
            stmts = globalStmts;
            existing = stmts.getMemoryById.get(args.memory_id);
            scope = "global";
        }

        if (!existing) {
            return {
                content: [{ type: "text", text: `❌ Memory not found: ${args.memory_id}` }],
                isError: true
            };
        }

        try {
            const timestamp = now();
            const newContent = args.content ?? existing.content;
            const newTags = args.tags ?? JSON.parse(existing.tags || "[]");
            const newTagsJson = JSON.stringify(newTags);
            const newConfidence = args.confidence ?? existing.confidence;

            // Regenerate embedding if content changed
            let newEmbedding = existing.embedding;
            if (args.content) {
                const textToEmbed = `${existing.title} ${newContent} ${newTags.join(" ")}`;
                const embedding = await generateEmbedding(textToEmbed);
                newEmbedding = embeddingToBuffer(embedding);
            }

            stmts.updateMemory.run(newContent, newTagsJson, newConfidence, newEmbedding, timestamp, args.memory_id);

            return {
                content: [{
                    type: "text",
                    text: `✅ Memory updated\n\n**ID**: ${args.memory_id}\n**Title**: ${existing.title}\n**Scope**: ${scope}\n**Updated at**: ${timestamp}`
                }]
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: `❌ Update failed: ${error.message}` }],
                isError: true
            };
        }
    }
);

server.tool(
    "memory_forget",
    `Delete a memory that is no longer relevant or was incorrect.

Use when:
- Information is outdated
- Memory was a mistake
- Project has changed significantly`,
    {
        memory_id: z.string().describe("The ID of the memory to delete"),
        reason: z.string().describe("Why this memory should be forgotten")
    },
    async (args) => {
        // Try to find in profile first, then global
        let stmts = profileStmts;
        let existing = stmts.getMemoryById.get(args.memory_id);
        let scope = "profile";

        if (!existing) {
            stmts = globalStmts;
            existing = stmts.getMemoryById.get(args.memory_id);
            scope = "global";
        }

        if (!existing) {
            return {
                content: [{ type: "text", text: `❌ Memory not found: ${args.memory_id}` }],
                isError: true
            };
        }

        try {
            stmts.deleteMemory.run(args.memory_id);

            return {
                content: [{
                    type: "text",
                    text: `✅ Memory forgotten\n\n**Title**: ${existing.title}\n**Scope**: ${scope}\n**Reason**: ${args.reason}`
                }]
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: `❌ Deletion failed: ${error.message}` }],
                isError: true
            };
        }
    }
);

// ───────────────────────────────────────────────────────────────────────────
// PROFILE MANAGEMENT
// ───────────────────────────────────────────────────────────────────────────

server.tool(
    "profile_info",
    `Get information about the current memory profile and available profiles.

Profiles allow you to have separate memories for different projects.`,
    {},
    async () => {
        const profilesDir = path.join(BASE_DATA_DIR, "profiles");
        let profiles = [];

        try {
            profiles = fs.readdirSync(profilesDir).filter(f => {
                return fs.statSync(path.join(profilesDir, f)).isDirectory();
            });
        } catch { }

        // Count memories per profile
        const counts = {};
        for (const profile of profiles) {
            try {
                const dbPath = path.join(profilesDir, profile, "memory.db");
                if (fs.existsSync(dbPath)) {
                    const tempDb = new Database(dbPath, { readonly: true });
                    const count = tempDb.prepare("SELECT COUNT(*) as count FROM memories").get();
                    counts[profile] = count.count;
                    tempDb.close();
                }
            } catch {
                counts[profile] = "?";
            }
        }

        const profileList = profiles.map(p => {
            const isCurrent = p === CURRENT_PROFILE;
            return `- ${p}: ${counts[p]} memories${isCurrent ? " ← current" : ""}`;
        }).join("\n");

        return {
            content: [{
                type: "text",
                text: `📂 **Profile Information**\n\n**Current Profile**: ${CURRENT_PROFILE}\n**Detection Method**: ${process.env.ECLIPSE_PROFILE ? "ENV variable" : "auto-detected from CWD"}\n\n**Available Profiles**:\n${profileList || "None"}\n\n**Note**: Set ECLIPSE_PROFILE env var to override auto-detection.`
            }]
        };
    }
);

// ───────────────────────────────────────────────────────────────────────────
// DECISION LOGGING
// ───────────────────────────────────────────────────────────────────────────

server.tool(
    "decision_log",
    `Record a significant technical decision for future reference.

Use when making choices that affect:
- Architecture
- Patterns or conventions
- Trade-offs between approaches
- Debugging strategies that worked/failed`,
    {
        decision: z.string().describe("What was decided"),
        context: z.string().describe("Why this decision was needed"),
        rationale: z.string().describe("Why this option was chosen over alternatives"),
        alternatives: z.string().optional().describe("What alternatives were considered")
    },
    async (args) => {
        const id = generateId();
        const session = profileStmts.getActiveSession.get();
        const timestamp = now();

        try {
            profileStmts.insertDecision.run(
                id,
                session?.id || null,
                args.decision,
                args.context,
                args.rationale,
                args.alternatives || null,
                timestamp
            );

            return {
                content: [{
                    type: "text",
                    text: `📋 Decision logged\n\n**ID**: ${id}\n**Profile**: ${CURRENT_PROFILE}\n**Decision**: ${args.decision}\n**Context**: ${args.context}\n**Rationale**: ${args.rationale}${args.alternatives ? `\n**Alternatives considered**: ${args.alternatives}` : ""}`
                }]
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: `❌ Failed to log decision: ${error.message}` }],
                isError: true
            };
        }
    }
);

server.tool(
    "decision_search",
    "Search past decisions for similar contexts",
    {
        query: z.string().describe("Natural language query about the decision context"),
        limit: z.number().int().min(1).max(10).optional().describe("Maximum results (default 5)")
    },
    async (args) => {
        const searchPattern = `%${args.query}%`;
        const limit = args.limit || 5;

        try {
            const results = profileStmts.searchDecisions.all(searchPattern, searchPattern, limit);

            if (results.length === 0) {
                return {
                    content: [{
                        type: "text",
                        text: `No past decisions found for: "${args.query}"`
                    }]
                };
            }

            const formatted = results.map((r, i) => {
                return `### ${i + 1}. ${r.decision}\n**Context**: ${r.context}\n**Rationale**: ${r.rationale}${r.alternatives ? `\n**Alternatives**: ${r.alternatives}` : ""}\n**Recorded**: ${r.created_at}`;
            }).join("\n\n---\n\n");

            return {
                content: [{
                    type: "text",
                    text: `Found ${results.length} past decisions:\n\n${formatted}`
                }]
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: `❌ Search failed: ${error.message}` }],
                isError: true
            };
        }
    }
);

// ═══════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
    // Pre-warm embedding model in background
    initEmbeddings().catch(() => { });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`Agent Core MCP v2.0 running | Profile: ${CURRENT_PROFILE} | Semantic search: ${embeddingReady ? "ready" : "loading..."}`);
}

main().catch(console.error);
