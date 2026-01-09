# Agent Core MCP Server v2.0

MCP unifié avec **semantic search**, **multi-profile**, loop control, planning, et memory.

## Nouvelles fonctionnalités v2.0

### 🧠 Semantic Search
- Utilise `all-MiniLM-L6-v2` pour générer des embeddings localement
- Recherche par similarité conceptuelle, pas juste par mots-clés
- Télécharge le modèle (~80MB) automatiquement au premier usage
- Fallback sur recherche keyword si embeddings indisponibles

### 📂 Multi-Profile
- Mémoire isolée par projet (auto-détecté via `package.json`, `.git`, etc.)
- Mémoire globale partagée entre tous les projets
- Variable `ECLIPSE_PROFILE` pour override manuel

## Architecture

```
~/.gemini/antigravity/agent-data/
├── profiles/
│   ├── global/           # Mémoire partagée
│   │   └── memory.db
│   ├── my-project/       # Mémoire projet
│   │   └── memory.db
│   └── other-project/
│       └── memory.db
└── .cache/
    └── models/           # Modèles HuggingFace
```

## 11 Outils Disponibles

| Catégorie | Tool | Description |
|-----------|------|-------------|
| **🔄 Loop** | `should_continue` | Vérifie si l'agent peut s'arrêter |
| **📋 Planning** | `task_start` | Démarre une session de travail |
| | `phase_transition` | Transition entre phases |
| | `checkpoint` | Log un point de progression |
| **🧠 Memory** | `memory_save` | Sauvegarde avec embedding |
| | `memory_search` | **Recherche sémantique** |
| | `memory_update` | Met à jour une mémoire |
| | `memory_forget` | Supprime une mémoire |
| **📂 Profile** | `profile_info` | **Info sur le profil actuel** |
| **📝 Decisions** | `decision_log` | Enregistre une décision |
| | `decision_search` | Recherche des décisions |

## Scopes de mémoire

| Scope | Description |
|-------|-------------|
| `profile` | Mémoire du projet actuel (par défaut pour save) |
| `global` | Mémoire partagée entre projets |
| `all` | Recherche dans les deux (par défaut pour search) |

## Usage

### Sauvegarder une mémoire projet-spécifique
```
memory_save(
  type: "semantic",
  title: "API convention",
  content: "Routes use /api/v1/{resource}",
  scope: "profile"  # Défaut
)
```

### Sauvegarder une mémoire globale
```
memory_save(
  type: "procedural",
  title: "Git workflow",
  content: "Always rebase before merge",
  scope: "global"
)
```

### Recherche sémantique
```
memory_search(
  query: "comment structurer les routes API",
  scope: "all"  # Cherche partout
)
# Trouve "API convention" même sans match exact de mots
```

### Voir le profil actuel
```
profile_info()
# Output:
# Current Profile: my-project
# Detection Method: auto-detected from CWD
# Available Profiles:
# - global: 15 memories
# - my-project: 8 memories ← current
# - other-project: 3 memories
```

## Configuration

### Override de profil
```bash
ECLIPSE_PROFILE=custom-project gemini
```

### Forcer profil global
```bash
ECLIPSE_PROFILE=global gemini
```

## Dépendances

- `@modelcontextprotocol/sdk` - MCP protocol
- `better-sqlite3` - Persistance
- `@huggingface/transformers` - Embeddings locaux
- `zod` - Validation

## Premier lancement

Au premier `memory_search`, le modèle `all-MiniLM-L6-v2` sera téléchargé:
```
[eclipse] Embedding model loaded: all-MiniLM-L6-v2
```

Note: Le téléchargement prend ~30s la première fois.
