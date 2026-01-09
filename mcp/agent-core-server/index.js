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
    version: "3.1.0",
});

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
                    suggest: isSkill ? "skill_from_session" : (checkpoints.length >= 2 ? "memory_save" : null)
                })
            }]
        };
    }
);

server.tool(
    "skill_from_session",
    `Generate skill template from session checkpoints. Returns JSON.`,
    {
        title: z.string().optional().describe("Title (auto-generated if omitted)"),
        session_id: z.string().optional().describe("Session ID (defaults to current/last)")
    },
    async (args) => {
        let session = args.session_id
            ? profileStmts.getSessionById.get(args.session_id)
            : profileStmts.getActiveSession.get();

        if (!session) {
            const recent = profileStmts.getRecentSessions.all(1);
            if (recent.length > 0) session = recent[0];
        }

        if (!session) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "no_session" }) }], isError: true };
        }

        const checkpoints = JSON.parse(session.checkpoints || "[]");

        if (checkpoints.length === 0) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "no_checkpoints" }) }] };
        }

        const title = args.title || session.task_summary;
        const steps = checkpoints.map(cp => cp.note || cp.summary).filter(Boolean);

        const taskLower = session.task_summary.toLowerCase();
        let trigger = session.task_summary;
        if (taskLower.includes('error') || taskLower.includes('fail')) {
            trigger = `Error: ${session.task_summary}`;
        }

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    status: "generated",
                    title,
                    trigger,
                    steps,
                    related: null,
                    save_with: `memory_save(type:"skill",title:"${title}",category:"skills",content:"TRIGGER:...STEPS:...RELATED:...")`
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

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    status: "started",
                    session: id.slice(0, 8),
                    profile: CURRENT_PROFILE,
                    task: args.task_summary,
                    memories: memories.length > 0 ? memories : null,
                    decisions: decisions.length > 0 ? decisions : null
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
        const scope = args.scope || "all";
        const nowTime = Date.now();

        // Collect memories
        let allMemories = [];
        if (scope === "all" || scope === "profile") {
            allMemories.push(...profileStmts.getAllMemories.all().map(m => ({ ...m, source: "profile" })));
        }
        if (scope === "all" || scope === "global") {
            allMemories.push(...globalStmts.getAllMemories.all().map(m => ({ ...m, source: "global" })));
        }

        if (allMemories.length === 0) {
            return {
                content: [{
                    type: "text",
                    text: `📊 **Memory Stats** (${scope})\n\nNo memories found.\n\n→ Use \`memory_save\` to start building your knowledge base.`
                }]
            };
        }

        // Count by type
        const byType = { semantic: 0, procedural: 0, episodic: 0 };
        const bySource = { profile: 0, global: 0 };
        let totalAccesses = 0;
        const neverAccessed = [];
        const decayed = [];

        for (const m of allMemories) {
            byType[m.type]++;
            bySource[m.source]++;
            totalAccesses += m.access_count;

            if (m.access_count === 0) {
                neverAccessed.push(m);
            }

            // Check decay
            const lastAccess = new Date(m.last_accessed).getTime();
            const daysSinceAccess = (nowTime - lastAccess) / (1000 * 60 * 60 * 24);
            if (daysSinceAccess > 30 && m.access_count === 0) {
                decayed.push({ ...m, daysSinceAccess: Math.floor(daysSinceAccess) });
            }
        }

        // Top accessed
        const topAccessed = [...allMemories]
            .sort((a, b) => b.access_count - a.access_count)
            .slice(0, 5);

        // Oldest
        const oldest = [...allMemories]
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
            .slice(0, 3);

        // Format output
        let output = `📊 **Memory Stats** (${scope})\n\n`;
        output += `**Total**: ${allMemories.length} memories\n\n`;

        output += `**By Type**:\n`;
        output += `├── semantic: ${byType.semantic} (${Math.round(byType.semantic / allMemories.length * 100)}%)\n`;
        output += `├── procedural: ${byType.procedural} (${Math.round(byType.procedural / allMemories.length * 100)}%)\n`;
        output += `└── episodic: ${byType.episodic} (${Math.round(byType.episodic / allMemories.length * 100)}%)\n\n`;

        if (scope === "all") {
            output += `**By Source**:\n`;
            output += `├── profile (${CURRENT_PROFILE}): ${bySource.profile}\n`;
            output += `└── global: ${bySource.global}\n\n`;
        }

        output += `**Top Accessed**:\n`;
        topAccessed.forEach((m, i) => {
            output += `${i + 1}. "${m.title}" (${m.access_count} accesses)\n`;
        });

        if (neverAccessed.length > 0) {
            output += `\n⚠️ **Never Accessed**: ${neverAccessed.length} memories\n`;
            neverAccessed.slice(0, 3).forEach(m => {
                output += `   - "${m.title}" (${m.id})\n`;
            });
            if (neverAccessed.length > 3) {
                output += `   ... and ${neverAccessed.length - 3} more\n`;
            }
            output += `\n→ Consider using \`memory_forget\` to clean up unused memories.`;
        }

        if (decayed.length > 0) {
            output += `\n\n🕐 **Decayed** (>30 days, never accessed): ${decayed.length} memories\n`;
            decayed.slice(0, 3).forEach(m => {
                output += `   - "${m.title}" (${m.daysSinceAccess} days old)\n`;
            });
        }

        return {
            content: [{ type: "text", text: output }]
        };
    }
);

server.tool(
    "memory_cluster",
    `Find memories similar to a specific memory.

Use this to:
- Discover related knowledge
- Identify duplicate or overlapping memories
- Build connections between concepts

→ Related tools: memory_search (for query-based search), memory_stats (for overview)`,
    {
        memory_id: z.string().describe("The ID of the memory to find similar memories for"),
        limit: z.number().int().min(1).max(10).optional().describe("Maximum results (default 5)")
    },
    async (args) => {
        const limit = args.limit || 5;

        // Find the source memory
        let sourceMemory = profileStmts.getMemoryById.get(args.memory_id);
        let sourceScope = "profile";
        if (!sourceMemory) {
            sourceMemory = globalStmts.getMemoryById.get(args.memory_id);
            sourceScope = "global";
        }

        if (!sourceMemory) {
            return {
                content: [{ type: "text", text: `❌ Memory not found: ${args.memory_id}\n\n→ Use \`memory_stats\` to see available memories.` }],
                isError: true
            };
        }

        const similar = await findSimilarMemories(args.memory_id, limit);

        if (similar.length === 0) {
            return {
                content: [{
                    type: "text",
                    text: `🔗 **Cluster for**: "${sourceMemory.title}"\n\nNo similar memories found.\n\n→ This memory is unique in your knowledge base.`
                }]
            };
        }

        let output = `🔗 **Cluster for**: "${sourceMemory.title}"\n`;
        output += `**Source**: ${sourceScope} | **Type**: ${sourceMemory.type}\n\n`;
        output += `**Similar Memories** (${similar.length}):\n\n`;

        similar.forEach((m, i) => {
            const similarity = (m.similarity * 100).toFixed(0);
            output += `### ${i + 1}. ${m.title}\n`;
            output += `**Match**: ${similarity}% | **Type**: ${m.type} | **Source**: ${m.source}\n`;
            output += `${m.content.slice(0, 150)}${m.content.length > 150 ? "..." : ""}\n\n`;
        });

        // Check for potential duplicates
        const duplicates = similar.filter(m => m.similarity > 0.9);
        if (duplicates.length > 0) {
            output += `\n⚠️ **Potential duplicates** (>90% similar): ${duplicates.length}\n`;
            output += `→ Consider using \`memory_forget\` to consolidate.`;
        }

        return {
            content: [{ type: "text", text: output }]
        };
    }
);

server.tool(
    "memory_compress",
    `Compress and clean up memory storage.

Operations:
- merge: Combine highly similar memories (>90% similarity) into one
- summarize: Shorten content of old, low-access memories
- prune: Remove memories that haven't been accessed in N days with 0 accesses

Use this for:
- Reducing memory storage
- Removing redundant information
- Keeping knowledge base clean

→ Related tools: memory_stats (see what to clean), memory_cluster (find duplicates)`,
    {
        operation: z.enum(["merge", "summarize", "prune"]).describe("Type of compression to perform"),
        target_id: z.string().optional().describe("For merge: the memory to merge others into"),
        days_threshold: z.number().int().optional().describe("For prune: remove unused memories older than N days (default 60)"),
        dry_run: z.boolean().optional().describe("Preview changes without applying (default true)")
    },
    async (args) => {
        const dryRun = args.dry_run !== false; // Default to true for safety
        const nowTime = Date.now();

        if (args.operation === "prune") {
            const threshold = args.days_threshold || 60;

            // Find candidates in both dbs
            const candidates = [];
            for (const [stmts, source] of [[profileStmts, "profile"], [globalStmts, "global"]]) {
                const memories = stmts.getAllMemories.all();
                for (const m of memories) {
                    if (m.access_count === 0) {
                        const age = (nowTime - new Date(m.created_at).getTime()) / (1000 * 60 * 60 * 24);
                        if (age > threshold) {
                            candidates.push({ ...m, source, age: Math.floor(age) });
                        }
                    }
                }
            }

            if (candidates.length === 0) {
                return {
                    content: [{ type: "text", text: `✅ No memories to prune (threshold: ${threshold} days, 0 accesses)` }]
                };
            }

            let output = dryRun ? `🔍 **Prune Preview** (dry run)\n\n` : `🗑️ **Pruning Memories**\n\n`;
            output += `**Threshold**: ${threshold} days, 0 accesses\n`;
            output += `**Candidates**: ${candidates.length} memories\n\n`;

            candidates.slice(0, 10).forEach((m, i) => {
                output += `${i + 1}. "${m.title}" (${m.age} days old, ${m.source})\n`;
            });

            if (candidates.length > 10) {
                output += `... and ${candidates.length - 10} more\n`;
            }

            if (!dryRun) {
                for (const m of candidates) {
                    const stmts = m.source === "global" ? globalStmts : profileStmts;
                    stmts.deleteMemory.run(m.id);
                }
                output += `\n✅ Deleted ${candidates.length} memories.`;
            } else {
                output += `\n→ Run with \`dry_run: false\` to apply.`;
            }

            return { content: [{ type: "text", text: output }] };
        }

        if (args.operation === "merge") {
            if (!args.target_id) {
                return {
                    content: [{ type: "text", text: `❌ merge requires target_id\n\n→ Use \`memory_cluster\` to find similar memories first, then specify which one to keep.` }],
                    isError: true
                };
            }

            // Find similar memories to merge
            const similar = await findSimilarMemories(args.target_id, 10);
            const toMerge = similar.filter(m => m.similarity > 0.9);

            if (toMerge.length === 0) {
                return {
                    content: [{ type: "text", text: `✅ No similar memories (>90%) to merge with ${args.target_id}` }]
                };
            }

            let output = dryRun ? `🔍 **Merge Preview** (dry run)\n\n` : `🔗 **Merging Memories**\n\n`;
            output += `**Target**: ${args.target_id}\n`;
            output += `**To merge**: ${toMerge.length} memories\n\n`;

            toMerge.forEach((m, i) => {
                output += `${i + 1}. "${m.title}" (${(m.similarity * 100).toFixed(0)}% similar)\n`;
            });

            if (!dryRun) {
                for (const m of toMerge) {
                    const stmts = m.source === "global" ? globalStmts : profileStmts;
                    stmts.deleteMemory.run(m.id);
                }
                output += `\n✅ Merged ${toMerge.length} memories into ${args.target_id}.`;
            } else {
                output += `\n→ Run with \`dry_run: false\` to apply.`;
            }

            return { content: [{ type: "text", text: output }] };
        }

        if (args.operation === "summarize") {
            // Find old, low-access memories with long content
            const candidates = [];
            for (const [stmts, source] of [[profileStmts, "profile"], [globalStmts, "global"]]) {
                const memories = stmts.getAllMemories.all();
                for (const m of memories) {
                    const age = (nowTime - new Date(m.last_accessed).getTime()) / (1000 * 60 * 60 * 24);
                    if (age > 30 && m.content.length > 500 && m.access_count < 3) {
                        candidates.push({ ...m, source, age: Math.floor(age) });
                    }
                }
            }

            if (candidates.length === 0) {
                return {
                    content: [{ type: "text", text: `✅ No memories need summarization\n(criteria: >30 days old, <3 accesses, >500 chars)` }]
                };
            }

            let output = `📝 **Summarization Candidates**\n\n`;
            output += `Found ${candidates.length} memories with long content (>500 chars), low usage (<3 accesses), older than 30 days.\n\n`;

            candidates.slice(0, 5).forEach((m, i) => {
                output += `${i + 1}. "${m.title}" (${m.content.length} chars, ${m.age} days old)\n`;
            });

            output += `\n⚠️ **Note**: Automatic summarization not implemented yet.\n`;
            output += `→ Consider manually shortening these memories with \`memory_update\`.`;

            return { content: [{ type: "text", text: output }] };
        }

        return {
            content: [{ type: "text", text: `❌ Unknown operation: ${args.operation}` }],
            isError: true
        };
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
                    text: `📋 Decision logged\n\n**ID**: ${id}\n**Profile**: ${CURRENT_PROFILE}\n**Decision**: ${args.decision}\n**Context**: ${args.context}\n**Rationale**: ${args.rationale}${args.alternatives ? `\n**Alternatives considered**: ${args.alternatives}` : ""}\n\n→ If this is a reusable pattern, also use \`memory_save\` (type: procedural) to remember it`
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
