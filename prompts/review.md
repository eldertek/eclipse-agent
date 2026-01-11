# 🔍 Review de Session - Débriefing Agent

Tu viens de terminer une tâche. Avant de passer à autre chose, fais une introspection complète.

---

## 1️⃣ OUTILS UTILISÉS

Liste TOUS les outils MCP que tu as appelés pendant cette session :

- Quels outils as-tu utilisés ? (begin_task, checkpoint, memory_search, file_context_scan, etc.)
- Combien de fois chacun ?
- Lesquels t'ont été les plus utiles ?
- Y a-t-il des outils que tu aurais DÛ utiliser mais que tu as ignorés ?

---

## 2️⃣ INSTRUCTIONS SUIVIES

Revois le prompt système (GEMINI.md) :

- Quelles règles as-tu bien respectées ?
- Quelles règles as-tu oubliées ou ignorées ?
- As-tu appelé `file_context_scan` avant de modifier des fichiers critiques ?
- As-tu fait des `checkpoint` réguliers ?
- As-tu cherché dans ta mémoire (`memory_search`) avant de résoudre le problème ?

---

## 3️⃣ CE QUI AURAIT PU ÊTRE MIEUX

Sois honnête et critique :

- Qu'est-ce qui a pris plus de temps que prévu ? Pourquoi ?
- As-tu fait des erreurs ? Lesquelles ?
- Si tu devais refaire cette tâche, que ferais-tu différemment ?
- Y a-t-il un outil qui te manquait ? → Utilise `tool_wishlist` pour le suggérer.

---

## 4️⃣ LEÇONS À RETENIR

Si tu as appris quelque chose de réutilisable :

- Appelle `memory_save` pour le sauvegarder (type: episodic ou procedural)
- Si c'était un échec éducatif, appelle `session_postmortem`

---

## 5️⃣ FORMAT DE RÉPONSE ATTENDU

Réponds dans ce format structuré :

```markdown
### Outils Utilisés
| Outil | Appels | Utilité (1-5) | Commentaire |
|-------|--------|---------------|-------------|
| begin_task | 1 | 5 | Essentiel pour démarrer |
| checkpoint | 3 | 4 | Aurait dû en faire plus |
| memory_search | 0 | - | ❌ Oublié ! |
| file_context_scan | 2 | 5 | M'a évité de répéter un bug |
| ... | ... | ... | ... |

### Conformité au Prompt (GEMINI.md)
- ✅ Respecté : begin_task au démarrage
- ✅ Respecté : end_task avec request_fulfilled=true
- ❌ Ignoré : file_context_scan avant modification de fichier auth
- ❌ Ignoré : memory_search après begin_task

### Axes d'Amélioration
1. J'aurais dû chercher dans la mémoire avant de réinventer la solution
2. Plus de checkpoints pendant le debugging
3. ...

### Leçons Sauvegardées
- `memory_save(type: "procedural", title: "...", content: "...")` → Sauvegardé
- `session_postmortem(...)` → Si applicable
- `tool_wishlist(...)` → Si un outil manquait
```

---

## 🚀 Commence ta review maintenant.

Analyse ta session et réponds avec le format ci-dessus.
