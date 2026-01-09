# Agent Core MCP Server

MCP unifié qui combine **loop control**, **planning**, **task tracking**, et **long-term memory** en un seul serveur.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      agent-core-server                          │
├─────────────────────────────────────────────────────────────────┤
│  🔄 LOOP CONTROL                                                │
│  └── should_continue    Décide si l'agent peut s'arrêter        │
├─────────────────────────────────────────────────────────────────┤
│  📋 PLANNING                                                    │
│  ├── task_start         Démarre une session de travail          │
│  ├── phase_transition   Transition entre phases                 │
│  └── checkpoint         Log un point de progression             │
├─────────────────────────────────────────────────────────────────┤
│  🧠 MEMORY                                                      │
│  ├── memory_save        Sauvegarde en mémoire long terme        │
│  ├── memory_search      Recherche dans la mémoire               │
│  ├── memory_update      Met à jour une mémoire existante        │
│  └── memory_forget      Supprime une mémoire obsolète           │
├─────────────────────────────────────────────────────────────────┤
│  📝 DECISIONS                                                   │
│  ├── decision_log       Enregistre une décision technique       │
│  └── decision_search    Recherche des décisions passées         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ~/.gemini/antigravity/agent-data/
                     agent-core.db (SQLite)
```

## Phases de travail

L'agent suit un workflow structuré :

```
understand → plan → execute → verify
    🔍         📋       ⚡        ✅
```

1. **understand** : Lire le code, clarifier les requirements, rechercher
2. **plan** : Formuler l'approche, identifier les risques
3. **execute** : Appliquer les changements (minimalistes)
4. **verify** : Tester, valider, critiquer

## Types de mémoire

| Type | Description | Exemples |
|------|-------------|----------|
| `semantic` | Connaissances factuelles | Conventions projet, architecture, préférences user |
| `procedural` | Comment faire | Workflows, patterns, best practices |
| `episodic` | Expériences passées | Décisions, erreurs, leçons apprises |

## Installation

```bash
cd mcp/agent-core-server
npm install
```

## Configuration MCP

Dans `~/.gemini/antigravity/mcp_config.json` :

```json
{
  "mcpServers": {
    "core": {
      "command": "node",
      "args": ["/path/to/mcp/agent-core-server/index.js"]
    }
  }
}
```

## Usage

### Loop Control

```
# L'agent DOIT appeler avant de s'arrêter
should_continue(
  task_summary: "Implémenter feature X",
  work_done: "1. Analysé le code, 2. Écrit la fonction, 3. Testé",
  stopping_reason: "task_complete",
  confidence: 0.95,
  verification_done: true
)
```

### Planning

```
# Démarrer une tâche
task_start(task_summary: "Refactorer le module auth")

# Transitionner entre phases
phase_transition(
  to_phase: "plan",
  phase_summary: "J'ai compris l'architecture actuelle, 3 services impliqués"
)

# Logger un checkpoint
checkpoint(
  note: "Token refresh fonctionne après fix du timing",
  importance: "high"
)
```

### Mémoire

```
# Sauvegarder une connaissance
memory_save(
  type: "semantic",
  category: "project-structure",
  title: "Convention de nommage API",
  content: "Routes: /api/v1/{resource}. Toujours pluriel. Verbs HTTP standard.",
  tags: ["api", "convention"]
)

# Rechercher avant de coder
memory_search(
  query: "convention API routes",
  memory_types: ["semantic", "procedural"]
)
```

### Décisions

```
# Logger une décision technique
decision_log(
  decision: "Utiliser JWT avec refresh token",
  context: "Besoin d'auth stateless pour scaling horizontal",
  rationale: "JWT permet validation sans DB hit, refresh token pour sécurité",
  alternatives: "Session cookies (rejeté: nécessite sticky sessions)"
)
```

## Persistance

Les données sont stockées dans `~/.gemini/antigravity/agent-data/agent-core.db` (SQLite).

Tables :
- `memories` : Mémoire long terme
- `sessions` : Sessions de travail et checkpoints
- `decisions` : Journal des décisions techniques
