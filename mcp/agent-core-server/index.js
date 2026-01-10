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
const { exec } = require("child_process");
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
      type TEXT NOT NULL CHECK(type IN ('semantic', 'procedural', 'episodic', 'skill')),
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

    -- Tool usage tracking
    CREATE TABLE IF NOT EXISTS tool_usage (
      tool_name TEXT PRIMARY KEY,
      call_count INTEGER DEFAULT 0,
      last_called TEXT,
      first_called TEXT
    );

    -- Memory links for knowledge graph
    CREATE TABLE IF NOT EXISTS memory_links (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relationship TEXT DEFAULT 'related_to',
      created_at TEXT NOT NULL,
      UNIQUE(source_id, target_id)
    );
    CREATE INDEX IF NOT EXISTS idx_links_source ON memory_links(source_id);
    CREATE INDEX IF NOT EXISTS idx_links_target ON memory_links(target_id);
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
let embeddingRetryCount = 0;
const MAX_EMBEDDING_RETRIES = 3;

async function initEmbeddings() {
    if (embeddingPipeline) return embeddingPipeline;

    // Allow retry if previous attempt failed and we haven't exceeded retries
    if (embeddingError && embeddingRetryCount >= MAX_EMBEDDING_RETRIES) {
        return null;
    }

    try {
        embeddingRetryCount++;
        console.error(`[eclipse] Loading embedding model (attempt ${embeddingRetryCount}/${MAX_EMBEDDING_RETRIES})...`);

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
        embeddingError = null;
        console.error("[eclipse] Embedding model loaded: all-MiniLM-L6-v2");
        return embeddingPipeline;
    } catch (err) {
        embeddingError = err;
        console.error(`[eclipse] Embedding attempt ${embeddingRetryCount} failed:`, err.message);

        if (embeddingRetryCount < MAX_EMBEDDING_RETRIES) {
            // Exponential backoff: 1s, 2s, 4s
            const delay = Math.pow(2, embeddingRetryCount - 1) * 1000;
            console.error(`[eclipse] Retrying in ${delay / 1000}s...`);
            await new Promise(r => setTimeout(r, delay));
            return initEmbeddings(); // Retry
        }

        console.error("[eclipse] Max retries reached, using keyword search");
        return null;
    }
}

async function generateEmbedding(text) {
    const pipe = await initEmbeddings();
    if (!pipe) return null;

    try {
        const output = await pipe(text, { pooling: "mean", normalize: true });
        return new Float32Array(output.data);
    } catch (err) {
        console.error("[eclipse] Embedding generation error:", err.message);
        // Reset to allow retry on next call
        embeddingPipeline = null;
        embeddingError = err;
        return null;
    }
}

// Auto-generate tags from content using simple keyword extraction
function extractKeywords(text, maxTags = 5) {
    // Common stop words to filter out
    const stopWords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
        'before', 'after', 'above', 'below', 'between', 'under', 'again',
        'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
        'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
        'no', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
        'can', 'will', 'just', 'should', 'now', 'is', 'are', 'was', 'were',
        'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
        'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
        'use', 'used', 'using', 'make', 'made', 'like', 'also', 'would', 'could'
    ]);

    // Extract words, filter, count frequency
    const words = text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopWords.has(w));

    const freq = {};
    for (const word of words) {
        freq[word] = (freq[word] || 0) + 1;
    }

    // Sort by frequency and return top N
    return Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxTags)
        .map(([word]) => word);
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
        getMemoryByPrefix: db.prepare(`SELECT * FROM memories WHERE id LIKE ? || '%' LIMIT 1`),
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
        getRecentSessions: db.prepare(`SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?`),
        getSessionById: db.prepare(`SELECT * FROM sessions WHERE id = ?`),
        updateSession: db.prepare(`UPDATE sessions SET current_phase = ?, checkpoints = ?, task_summary = COALESCE(?, task_summary) WHERE id = ?`),
        endSession: db.prepare(`UPDATE sessions SET ended_at = ? WHERE id = ?`),
        reopenSession: db.prepare(`UPDATE sessions SET ended_at = NULL WHERE id = ?`),

        insertDecision: db.prepare(`INSERT INTO decisions (id, session_id, decision, context, rationale, alternatives, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`),
        searchDecisions: db.prepare(`SELECT * FROM decisions WHERE decision LIKE ? OR context LIKE ? ORDER BY created_at DESC LIMIT ?`),

        // Tool usage tracking
        trackTool: db.prepare(`
            INSERT INTO tool_usage (tool_name, call_count, last_called, first_called)
            VALUES (?, 1, ?, ?)
            ON CONFLICT(tool_name) DO UPDATE SET call_count = call_count + 1, last_called = ?
        `),
        getToolStats: db.prepare(`SELECT * FROM tool_usage ORDER BY call_count DESC`),
    };
}

const profileStmts = prepareStatements(profileDb);
const globalStmts = prepareStatements(globalDb);

// Track tool usage - non-blocking to prevent SQLite locks
function trackTool(name) {
    setImmediate(() => {
        const ts = now();
        try {
            profileStmts.trackTool.run(name, ts, ts, ts);
        } catch (err) {
            // Silently fail on tracking errors to not disrupt main flow
            // console.error("Tracking error:", err.message);
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function generateId() {
    return crypto.randomBytes(8).toString("hex");
}

function now() {
    return new Date().toISOString();
}

// Find memory by full ID or short prefix (8 chars)
function findMemoryById(memoryId) {
    // Try exact match first (profile then global)
    let memory = profileStmts.getMemoryById.get(memoryId);
    let scope = "profile";
    let db = profileDb;

    if (!memory) {
        memory = globalStmts.getMemoryById.get(memoryId);
        scope = "global";
        db = globalDb;
    }

    // Try prefix match if exact failed and ID is short
    if (!memory && memoryId.length <= 8) {
        memory = profileStmts.getMemoryByPrefix.get(memoryId);
        scope = "profile";
        db = profileDb;

        if (!memory) {
            memory = globalStmts.getMemoryByPrefix.get(memoryId);
            scope = "global";
            db = globalDb;
        }
    }

    return memory ? { memory, scope, db } : null;
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

    // Calculate similarity scores with temporal decay and hybrid keyword matching
    const nowTime = Date.now();
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    const scored = allMemories.map(memory => {
        const memoryEmbedding = bufferToEmbedding(memory.embedding);
        const semanticSimilarity = memoryEmbedding ? cosineSimilarity(queryEmbedding, memoryEmbedding) : 0;

        // Hybrid: keyword matching boost
        const memoryText = `${memory.title} ${memory.content} ${memory.tags}`.toLowerCase();
        const keywordMatches = queryWords.filter(w => memoryText.includes(w)).length;
        const keywordBoost = Math.min(keywordMatches * 0.05, 0.2); // Up to 0.2 boost for keywords

        // Boost by access count (slight preference for frequently used memories)
        const accessBoost = Math.min(memory.access_count * 0.01, 0.1);

        // Temporal decay: reduce score for old, unused memories
        const lastAccess = new Date(memory.last_accessed).getTime();
        const daysSinceAccess = (nowTime - lastAccess) / (1000 * 60 * 60 * 24);
        const decayFactor = memory.access_count === 0
            ? Math.max(0.5, 1 - (daysSinceAccess / 60)) // Unused: decay to 0.5 over 60 days
            : Math.max(0.8, 1 - (daysSinceAccess / 180)); // Used: decay to 0.8 over 180 days

        const combinedScore = (semanticSimilarity * 0.7 + keywordBoost * 0.3 + accessBoost) * decayFactor;

        return {
            ...memory,
            similarity: combinedScore,
            rawSimilarity: semanticSimilarity,
            keywordMatches,
            decayFactor,
            daysSinceAccess: Math.floor(daysSinceAccess)
        };
    });

    // Sort by similarity and return top results
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
}

// Clustering helper: find memories similar to a given memory
async function findSimilarMemories(memoryId, limit = 5) {
    // Find the memory
    let memory = profileStmts.getMemoryById.get(memoryId);
    let source = "profile";
    if (!memory) {
        memory = globalStmts.getMemoryById.get(memoryId);
        source = "global";
    }
    if (!memory) return [];

    const embedding = bufferToEmbedding(memory.embedding);
    if (!embedding) return [];

    // Get all memories except this one
    const allMemories = [
        ...profileStmts.getAllMemories.all().map(m => ({ ...m, source: "profile" })),
        ...globalStmts.getAllMemories.all().map(m => ({ ...m, source: "global" }))
    ].filter(m => m.id !== memoryId);

    // Score by similarity
    const scored = allMemories.map(m => {
        const memEmb = bufferToEmbedding(m.embedding);
        const similarity = memEmb ? cosineSimilarity(embedding, memEmb) : 0;
        return { ...m, similarity };
    });

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════════════
// MCP SERVER
// ═══════════════════════════════════════════════════════════════════════════

const server = new McpServer({
    name: "agent-core",
    version: "3.3.0",
});

// Wrapper to auto-track tool usage
function tracked(name, handler) {
    return async (args) => {
        trackTool(name);
        return handler(args);
    };
}

// ───────────────────────────────────────────────────────────────────────────
// LOOP CONTROL
// ───────────────────────────────────────────────────────────────────────────

server.tool(
    "end_task",
    `Quick way to finish a task.

Automatically builds work summary from your checkpoints.
Just confirm what you accomplished.

Use when you're done and want to wrap up quickly.`,
    {
        summary: z.string().describe("One line: what did you accomplish?"),
        verified: z.boolean().optional().describe("Did you test/verify the solution? (default: true)")
    },
    async (args) => {
        trackTool("end_task");
        const session = profileStmts.getActiveSession.get();

        if (!session) {
            return {
                content: [{ type: "text", text: JSON.stringify({ status: "ok", warning: "no_session" }) }]
            };
        }

        const checkpoints = JSON.parse(session.checkpoints || "[]");
        const workDone = checkpoints.map(cp => cp.note || cp.summary).filter(Boolean);
        workDone.push(args.summary);

        profileStmts.endSession.run(now(), session.id);

        const taskLower = session.task_summary.toLowerCase();
        const isSkill = checkpoints.length >= 2 &&
            ['fix', 'debug', 'deploy', 'error', 'fail', 'issue', 'problem', 'bug'].some(w => taskLower.includes(w));

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    status: "complete",
                    session: session.id.slice(0, 8),
                    task: session.task_summary,
                    verified: args.verified !== false,
                    work: workDone,
                    suggest: checkpoints.length >= 2 ? "memory_save" : null
                })
            }]
        };
    }
);



// ───────────────────────────────────────────────────────────────────────────
// PLANNING & TASK TRACKING
// ───────────────────────────────────────────────────────────────────────────

server.tool(
    "begin_task",
    `Start working on a task. This single tool replaces the need for multiple setup calls.

Automatically:
- Creates a tracking session
- Searches memory for relevant knowledge
- Finds similar past decisions
- Returns everything you need to start

Just call this ONCE at the start, then get to work.

Current profile: ${CURRENT_PROFILE}`,
    {
        task_summary: z.string().describe("Brief description of what you're about to do")
    },
    async (args) => {
        trackTool("begin_task");
        const id = generateId();
        const timestamp = now();

        // End any existing active session
        const active = profileStmts.getActiveSession.get();
        if (active) {
            profileStmts.endSession.run(timestamp, active.id);
        }

        profileStmts.insertSession.run(id, timestamp, args.task_summary);

        // Auto memory search
        const memoryResults = await semanticSearch(args.task_summary, {
            memoryTypes: ["semantic", "procedural", "episodic"],
            limit: 3,
            scope: "all"
        });

        // Auto decision search
        const searchPattern = `%${args.task_summary.split(' ').slice(0, 3).join('%')}%`;
        const decisionResults = profileStmts.searchDecisions.all(searchPattern, searchPattern, 3);
        // Build JSON output
        const memories = memoryResults.map(m => ({
            title: m.title,
            match: m.similarity ? Math.round(m.similarity * 100) : null,
            preview: m.content.replace(/\n/g, ' ').slice(0, 80)
        }));

        const decisions = decisionResults.map(d => ({
            decision: d.decision,
            reason: d.rationale.slice(0, 60)
        }));

        // Build action required message based on what was found
        let actionRequired = null;
        if (memories.length > 0 || decisions.length > 0) {
            actionRequired = "⚠️ READ ABOVE before working. Your past self may have already solved this.";
        }

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    status: "started",
                    session: id.slice(0, 8),
                    profile: CURRENT_PROFILE,
                    task: args.task_summary,
                    memories: memories.length > 0 ? memories : null,
                    decisions: decisions.length > 0 ? decisions : null,
                    action_required: actionRequired
                })
            }]
        };
    }
);

server.tool(
    "task_resume",
    `Resume previous session or list recent sessions. Returns JSON.`,
    {
        session_id: z.string().optional().describe("Session ID (omit to list recent)")
    },
    async (args) => {
        trackTool("task_resume");
        if (!args.session_id) {
            const sessions = profileStmts.getRecentSessions.all(10);

            if (sessions.length === 0) {
                return { content: [{ type: "text", text: JSON.stringify({ sessions: [] }) }] };
            }

            const list = sessions.map(s => ({
                id: s.id.slice(0, 8),
                task: s.task_summary,
                phase: s.current_phase,
                checkpoints: JSON.parse(s.checkpoints || "[]").length,
                status: s.ended_at ? "done" : "active",
                date: new Date(s.started_at).toISOString().split('T')[0]
            }));

            return { content: [{ type: "text", text: JSON.stringify({ sessions: list }) }] };
        }

        const session = profileStmts.getSessionById.get(args.session_id);

        if (!session) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "not_found", id: args.session_id }) }], isError: true };
        }

        if (session.ended_at) {
            profileStmts.reopenSession.run(args.session_id);
        }

        const checkpoints = JSON.parse(session.checkpoints || "[]");
        const lastCheckpoints = checkpoints.slice(-3).map(cp => cp.note || cp.summary);

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    status: "resumed",
                    id: session.id.slice(0, 8),
                    task: session.task_summary,
                    phase: session.current_phase,
                    checkpoints: checkpoints.length,
                    last_notes: lastCheckpoints
                })
            }]
        };
    }
);

server.tool(
    "checkpoint",
    `Log progress. Returns JSON.`,
    {
        note: z.string().describe("What you accomplished or discovered"),
        importance: z.enum(["low", "medium", "high"]).optional().describe("Significance (default: medium)")
    },
    async (args) => {
        trackTool("checkpoint");
        const session = profileStmts.getActiveSession.get();

        if (!session) {
            return {
                content: [{ type: "text", text: JSON.stringify({ error: "no_session" }) }]
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

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    status: "logged",
                    checkpoint: checkpoints.length,
                    note: args.note,
                    suggest: args.importance === "high" ? "memory_save" : null
                })
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
- skill: Structured how-to with trigger conditions and steps

For SKILL type, format content as:
  TRIGGER: When this happens...
  STEPS:
  1. First step
  2. Second step
  RELATED: tables, commands, or files involved

Scope:
- profile (default): Saved to current project (${CURRENT_PROFILE})
- global: Saved to shared memory across all projects

Be PARSIMONIOUS: only save what's genuinely useful for future work.`,
    {
        type: z.enum(["semantic", "procedural", "episodic", "skill"]).describe("Type of memory"),
        category: z.string().describe("Category (e.g., 'debugging', 'deployment', 'api-patterns')"),
        title: z.string().describe("Brief, searchable title"),
        content: z.string().describe("The knowledge to remember (for skill: use TRIGGER/STEPS/RELATED format)"),
        tags: z.array(z.string()).optional().describe("Tags for search"),
        confidence: z.number().min(0).max(1).optional().describe("Confidence level (0.0-1.0), default 1.0"),
        scope: z.enum(["profile", "global"]).optional().describe("Where to save: profile (project-specific) or global (shared)")
    },
    async (args) => {
        trackTool("memory_save");
        const id = generateId();
        const timestamp = now();
        const scope = args.scope || "profile";
        const stmts = scope === "global" ? globalStmts : profileStmts;

        // Auto-generate tags if not provided
        let tags = args.tags || [];
        if (tags.length === 0) {
            tags = extractKeywords(`${args.title} ${args.content}`, 5);
        }
        const tagsJson = JSON.stringify(tags);

        // Generate embedding for semantic search
        const textToEmbed = `${args.title} ${args.content} ${tags.join(" ")}`;
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

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        status: "saved",
                        id: id.slice(0, 8),
                        type: args.type,
                        category: args.category,
                        title: args.title,
                        scope,
                        embedding: !!embedding
                    })
                }]
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: JSON.stringify({ error: error.message }) }],
                isError: true
            };
        }
    }
);

server.tool(
    "memory_search",
    `Search memories using semantic similarity. Returns JSON.`,
    {
        query: z.string().describe("Search query"),
        memory_types: z.array(z.enum(["semantic", "procedural", "episodic", "skill"])).optional().describe("Filter by types"),
        limit: z.number().int().min(1).max(20).optional().describe("Max results (default 5)"),
        scope: z.enum(["all", "profile", "global"]).optional().describe("Where to search")
    },
    async (args) => {
        trackTool("memory_search");
        const types = args.memory_types || ["semantic", "procedural", "episodic", "skill"];
        const limit = args.limit || 5;
        const scope = args.scope || "all";

        try {
            const results = await semanticSearch(args.query, { memoryTypes: types, limit, scope });

            const timestamp = now();
            for (const r of results) {
                const stmts = r.source === "global" ? globalStmts : profileStmts;
                stmts.incrementAccess.run(timestamp, r.id);
            }

            if (results.length === 0) {
                return { content: [{ type: "text", text: JSON.stringify({ results: [] }) }] };
            }

            const formatted = results.map(r => ({
                id: r.id.slice(0, 8),
                title: r.title,
                type: r.type,
                category: r.category,
                match: r.similarity ? Math.round(r.similarity * 100) : null,
                content: r.content.slice(0, 150),
                source: r.source
            }));

            return { content: [{ type: "text", text: JSON.stringify({ results: formatted }) }] };
        } catch (error) {
            return { content: [{ type: "text", text: JSON.stringify({ error: error.message }) }], isError: true };
        }
    }
);

server.tool(
    "memory_update",
    "Update existing memory. Returns JSON.",
    {
        memory_id: z.string().describe("Memory ID"),
        content: z.string().optional().describe("New content"),
        tags: z.array(z.string()).optional().describe("New tags"),
        confidence: z.number().min(0).max(1).optional().describe("Updated confidence")
    },
    async (args) => {
        trackTool("memory_update");
        let stmts = profileStmts;
        let existing = stmts.getMemoryById.get(args.memory_id);
        let scope = "profile";

        if (!existing) {
            stmts = globalStmts;
            existing = stmts.getMemoryById.get(args.memory_id);
            scope = "global";
        }

        if (!existing) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "not_found", id: args.memory_id }) }], isError: true };
        }

        try {
            const timestamp = now();
            const newContent = args.content ?? existing.content;
            const newTags = args.tags ?? JSON.parse(existing.tags || "[]");
            const newConfidence = args.confidence ?? existing.confidence;

            let newEmbedding = existing.embedding;
            if (args.content) {
                const embedding = await generateEmbedding(`${existing.title} ${newContent} ${newTags.join(" ")}`);
                newEmbedding = embeddingToBuffer(embedding);
            }

            stmts.updateMemory.run(newContent, JSON.stringify(newTags), newConfidence, newEmbedding, timestamp, args.memory_id);

            return { content: [{ type: "text", text: JSON.stringify({ status: "updated", id: args.memory_id.slice(0, 8), scope }) }] };
        } catch (error) {
            return { content: [{ type: "text", text: JSON.stringify({ error: error.message }) }], isError: true };
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
        trackTool("memory_forget");
        let stmts = profileStmts;
        let existing = stmts.getMemoryById.get(args.memory_id);
        let scope = "profile";

        if (!existing) {
            stmts = globalStmts;
            existing = stmts.getMemoryById.get(args.memory_id);
            scope = "global";
        }

        if (!existing) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "not_found", id: args.memory_id }) }], isError: true };
        }

        try {
            stmts.deleteMemory.run(args.memory_id);
            return { content: [{ type: "text", text: JSON.stringify({ status: "deleted", id: args.memory_id.slice(0, 8), title: existing.title, scope }) }] };
        } catch (error) {
            return { content: [{ type: "text", text: JSON.stringify({ error: error.message }) }], isError: true };
        }
    }
);

server.tool(
    "memory_link",
    `Create or view links between related memories to build a knowledge graph.

Operations:
- create: Link two memories together
- list: Show all links for a memory
- delete: Remove a link

Relationships: related_to, depends_on, supersedes, example_of`,
    {
        operation: z.enum(["create", "list", "delete"]).describe("Link operation"),
        source_id: z.string().describe("Source memory ID"),
        target_id: z.string().optional().describe("Target memory ID (for create/delete)"),
        relationship: z.enum(["related_to", "depends_on", "supersedes", "example_of"]).optional().describe("Type of relationship (default: related_to)")
    },
    async (args) => {
        trackTool("memory_link");
        const ts = now();

        // Find source memory (supports short IDs)
        const sourceResult = findMemoryById(args.source_id);
        if (!sourceResult) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "source_not_found", id: args.source_id }) }], isError: true };
        }
        const { memory: source, db: sourceDb } = sourceResult;
        const sourceFullId = source.id;

        if (args.operation === "list") {
            // Get all links where this memory is source or target
            const outgoing = sourceDb.prepare("SELECT * FROM memory_links WHERE source_id = ?").all(sourceFullId);
            const incoming = sourceDb.prepare("SELECT * FROM memory_links WHERE target_id = ?").all(sourceFullId);

            const links = [
                ...outgoing.map(l => ({ direction: "->", target: l.target_id.slice(0, 8), rel: l.relationship })),
                ...incoming.map(l => ({ direction: "<-", source: l.source_id.slice(0, 8), rel: l.relationship }))
            ];

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        memory: source.title,
                        links: links.length > 0 ? links : null
                    })
                }]
            };
        }

        if (args.operation === "create") {
            if (!args.target_id) {
                return { content: [{ type: "text", text: JSON.stringify({ error: "target_id required" }) }], isError: true };
            }

            // Find target memory (supports short IDs)
            const targetResult = findMemoryById(args.target_id);
            if (!targetResult) {
                return { content: [{ type: "text", text: JSON.stringify({ error: "target_not_found", id: args.target_id }) }], isError: true };
            }
            const { memory: target } = targetResult;
            const targetFullId = target.id;

            const id = generateId();
            const rel = args.relationship || "related_to";

            try {
                sourceDb.prepare("INSERT OR REPLACE INTO memory_links (id, source_id, target_id, relationship, created_at) VALUES (?, ?, ?, ?, ?)").run(id, sourceFullId, targetFullId, rel, ts);
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            status: "linked",
                            source: source.title,
                            target: target.title,
                            relationship: rel
                        })
                    }]
                };
            } catch (err) {
                return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
            }
        }

        if (args.operation === "delete") {
            if (!args.target_id) {
                return { content: [{ type: "text", text: JSON.stringify({ error: "target_id required" }) }], isError: true };
            }

            // Find target to get full ID
            const targetResult = findMemoryById(args.target_id);
            const targetFullId = targetResult ? targetResult.memory.id : args.target_id;

            const result = sourceDb.prepare("DELETE FROM memory_links WHERE source_id = ? AND target_id = ?").run(sourceFullId, targetFullId);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        status: result.changes > 0 ? "deleted" : "not_found"
                    })
                }]
            };
        }

        return { content: [{ type: "text", text: JSON.stringify({ error: "unknown_operation" }) }], isError: true };
    }
);

// ───────────────────────────────────────────────────────────────────────────
// MEMORY ANALYTICS & CLUSTERING
// ───────────────────────────────────────────────────────────────────────────

server.tool(
    "memory_stats",
    `Get statistics about your memory usage.

Shows:
- Total memories by type and scope
- Most accessed memories
- Never accessed memories (candidates for cleanup)
- Oldest memories
- Decay status

Use this to:
- Understand your knowledge base
- Identify cleanup candidates
- Track memory health

→ Related tools: memory_forget (to clean up), memory_search (to explore)`,
    {
        scope: z.enum(["all", "profile", "global"]).optional().describe("Which memories to analyze (default: all)")
    },
    async (args) => {
        trackTool("memory_stats");
        const scope = args.scope || "all";
        const nowTime = Date.now();

        let allMemories = [];
        if (scope === "all" || scope === "profile") {
            allMemories.push(...profileStmts.getAllMemories.all().map(m => ({ ...m, source: "profile" })));
        }
        if (scope === "all" || scope === "global") {
            allMemories.push(...globalStmts.getAllMemories.all().map(m => ({ ...m, source: "global" })));
        }

        if (allMemories.length === 0) {
            return { content: [{ type: "text", text: JSON.stringify({ total: 0 }) }] };
        }

        const byType = { semantic: 0, procedural: 0, episodic: 0, skill: 0 };
        const neverAccessed = [];

        for (const m of allMemories) {
            byType[m.type] = (byType[m.type] || 0) + 1;
            if (m.access_count === 0) neverAccessed.push(m.id.slice(0, 8));
        }

        const topAccessed = [...allMemories]
            .sort((a, b) => b.access_count - a.access_count)
            .slice(0, 5)
            .map(m => ({ title: m.title, accesses: m.access_count }));

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    total: allMemories.length,
                    byType,
                    topAccessed,
                    neverAccessed: neverAccessed.slice(0, 5)
                })
            }]
        };
    }
);

server.tool(
    "memory_maintain",
    `Memory maintenance operations: find similar, merge duplicates, prune old memories.

Operations:
- find_similar: Find memories similar to a given ID (requires memory_id)
- merge: Combine similar memories >90% into target (requires target_id)
- prune: Remove memories with 0 accesses older than N days (default 60)

→ Related tools: memory_stats (overview), memory_forget (manual delete)`,
    {
        operation: z.enum(["find_similar", "merge", "prune"]).describe("Maintenance operation"),
        memory_id: z.string().optional().describe("For find_similar: the memory to find similar ones for"),
        target_id: z.string().optional().describe("For merge: the memory to merge others into"),
        days_threshold: z.number().int().optional().describe("For prune: days threshold (default 60)"),
        limit: z.number().int().min(1).max(10).optional().describe("For find_similar: max results (default 5)"),
        dry_run: z.boolean().optional().describe("Preview without applying (default true)")
    },
    async (args) => {
        trackTool("memory_maintain");
        const dryRun = args.dry_run !== false;
        const nowTime = Date.now();

        // FIND_SIMILAR
        if (args.operation === "find_similar") {
            if (!args.memory_id) {
                return { content: [{ type: "text", text: JSON.stringify({ error: "memory_id required" }) }], isError: true };
            }
            const limit = args.limit || 5;
            let sourceMemory = profileStmts.getMemoryById.get(args.memory_id);
            if (!sourceMemory) sourceMemory = globalStmts.getMemoryById.get(args.memory_id);
            if (!sourceMemory) {
                return { content: [{ type: "text", text: JSON.stringify({ error: "not_found" }) }], isError: true };
            }
            const similar = await findSimilarMemories(args.memory_id, limit);
            const results = similar.map(m => ({
                id: m.id.slice(0, 8),
                title: m.title,
                match: Math.round(m.similarity * 100),
                type: m.type
            }));
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        source: sourceMemory.title,
                        similar: results,
                        duplicates: results.filter(r => r.match > 90).length
                    })
                }]
            };
        }

        // PRUNE
        if (args.operation === "prune") {
            const threshold = args.days_threshold || 60;
            const candidates = [];
            for (const [stmts, source] of [[profileStmts, "profile"], [globalStmts, "global"]]) {
                const memories = stmts.getAllMemories.all();
                for (const m of memories) {
                    if (m.access_count === 0) {
                        const age = (nowTime - new Date(m.created_at).getTime()) / (1000 * 60 * 60 * 24);
                        if (age > threshold) candidates.push({ ...m, source, age: Math.floor(age) });
                    }
                }
            }
            if (candidates.length === 0) {
                return { content: [{ type: "text", text: JSON.stringify({ status: "clean", threshold }) }] };
            }
            if (!dryRun) {
                for (const m of candidates) {
                    const stmts = m.source === "global" ? globalStmts : profileStmts;
                    stmts.deleteMemory.run(m.id);
                }
            }
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        status: dryRun ? "preview" : "pruned",
                        count: candidates.length,
                        threshold,
                        samples: candidates.slice(0, 5).map(m => ({ title: m.title, age: m.age }))
                    })
                }]
            };
        }

        // MERGE
        if (args.operation === "merge") {
            if (!args.target_id) {
                return { content: [{ type: "text", text: JSON.stringify({ error: "target_id required" }) }], isError: true };
            }
            const similar = await findSimilarMemories(args.target_id, 10);
            const toMerge = similar.filter(m => m.similarity > 0.9);
            if (toMerge.length === 0) {
                return { content: [{ type: "text", text: JSON.stringify({ status: "no_duplicates" }) }] };
            }
            if (!dryRun) {
                for (const m of toMerge) {
                    const stmts = m.source === "global" ? globalStmts : profileStmts;
                    stmts.deleteMemory.run(m.id);
                }
            }
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        status: dryRun ? "preview" : "merged",
                        target: args.target_id,
                        merged: toMerge.length,
                        items: toMerge.map(m => ({ title: m.title, match: Math.round(m.similarity * 100) }))
                    })
                }]
            };
        }

        return { content: [{ type: "text", text: JSON.stringify({ error: "unknown_operation" }) }], isError: true };
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
        trackTool("profile_info");
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
                text: JSON.stringify({
                    current: CURRENT_PROFILE,
                    detection: process.env.ECLIPSE_PROFILE ? "env" : "cwd",
                    profiles: Object.entries(counts).map(([name, count]) => ({ name, count, current: name === CURRENT_PROFILE }))
                })
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
        trackTool("decision_log");
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

            return { content: [{ type: "text", text: JSON.stringify({ status: "logged", id: id.slice(0, 8), decision: args.decision }) }] };
        } catch (error) {
            return { content: [{ type: "text", text: JSON.stringify({ error: error.message }) }], isError: true };
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
        trackTool("decision_search");
        const searchPattern = `%${args.query}%`;
        const limit = args.limit || 5;

        try {
            const results = profileStmts.searchDecisions.all(searchPattern, searchPattern, limit);

            const formatted = results.map(r => ({
                decision: r.decision,
                context: r.context.slice(0, 80),
                rationale: r.rationale.slice(0, 80)
            }));

            return { content: [{ type: "text", text: JSON.stringify({ results: formatted }) }] };
        } catch (error) {
            return { content: [{ type: "text", text: JSON.stringify({ error: error.message }) }], isError: true };
        }
    }
);



// ═══════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════


server.tool(
    "git_commit",
    "Stage, commit, and push/pull changes with an AI-generated message using gemini CLI.",
    {
        action: z.enum(["commit_only", "push", "pull"]).default("pull").describe("Action to perform after commit"),
        extra_context: z.string().optional().describe("Additional context for the commit message")
    },
    async (args) => {
        trackTool("git_commit");
        // Use the current working directory (where the agent was invoked)
        const cwd = process.cwd();
        const execAsync = (cmd) => new Promise((resolve, reject) => {
            exec(cmd, { cwd, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => { // 10MB buffer
                if (error) reject(error);
                else resolve(stdout.slice(0, 50000).trim()); // Truncate huge outputs
            });
        });

        const geminiPath = "gemini"; // Assuming in PATH, otherwise use full path

        try {
            // 1. Check for changes
            try {
                await execAsync("git diff --cached --quiet").catch(async () => {
                    // diff --quiet returns 1 if there are changes. If it returns 0 (success), NO changes.
                    // Wait, logic is: exit 1 = changes, exit 0 = no changes.
                    // But here we want to know if we need to add.
                    // Let's just run git add -A always.
                    await execAsync("git add -A");
                });
                await execAsync("git add -A"); // Ensure everything added
            } catch (e) {
                // Ignore
            }

            const finalDiff = await execAsync("git diff --cached");
            if (!finalDiff) {
                return { content: [{ type: "text", text: JSON.stringify({ error: "No changes to commit." }) }], isError: true };
            }

            // 2. Generate message
            // We ask for XML tags to robustly extract the message from agent chatter
            const prompt = `Generate a concise, conventional git commit message for this diff. Output ONLY the commit message inside <COMMIT_MSG> tags. Context: ${args.extra_context || "None"}. Diff: \n${finalDiff.slice(0, 8000)}`;

            const geminiCmd = `${geminiPath} --yolo "${prompt.replace(/"/g, '\\"')}"`;

            let message = "update";
            try {
                // We accept failure here to fallback to manual message if AI fails
                const output = await execAsync(geminiCmd);
                const match = output.match(/<COMMIT_MSG>(.*?)<\/COMMIT_MSG>/s);
                if (match) {
                    message = match[1].trim();
                } else {
                    // Fallback: try to find a Conventional Commit style line
                    const lines = output.split('\n');
                    const convLine = lines.find(l => /^(feat|fix|docs|style|refactor|perf|test|chore)(\(.+\))?: ./.test(l));
                    if (convLine) message = convLine.trim();
                }
            } catch (e) {
                console.error("Gemini generation error:", e);
                message = "chore: update (auto-commit fallback)";
            }

            // Cleanup message (remove quotes that might break shell)
            message = message.replace(/"/g, "'");

            // 3. Commit
            await execAsync(`git commit -m "${message}"`);

            // 4. Post-action
            let postOutput = "";
            if (args.action === "pull") {
                postOutput = await execAsync("git pull");
            } else if (args.action === "push") {
                postOutput = await execAsync("git push");
            }

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        status: "success",
                        message: message,
                        action: args.action,
                        output: postOutput
                    })
                }]
            };

        } catch (error) {
            return { content: [{ type: "text", text: JSON.stringify({ error: error.message }) }], isError: true };
        }
    }
);

async function main() {
    // Pre-warm embedding model in background
    initEmbeddings().catch(() => { });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`Agent Core MCP v2.0 running | Profile: ${CURRENT_PROFILE} | Semantic search: ${embeddingReady ? "ready" : "loading..."}`);
}

main().catch(console.error);
