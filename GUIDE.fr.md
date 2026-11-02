# Guide d'utilisation

Comment installer, vérifier, lancer et dépanner le moteur de réponse sur documents. Pour l'architecture et les choix de conception, voir [README.md](README.md). La version anglaise de ce guide est [GUIDE.md](GUIDE.md).

Les commandes, noms de fichiers et messages du programme restent en anglais, exactement tels que le code les affiche.

## 1. Ce que fait l'outil

À partir d'une data room (`data/case/files/` + `data/case/manifest.json`) et d'un questionnaire (`data/playbook/questions.json`), il renvoie une réponse JSON. Pour chaque question, elle contient une valeur canonique et ses fichiers sources, ainsi que le coût estimé des appels au modèle. Le format suit `data/playbook/candidate-output-schema.json`. Le modèle OpenRouter est imposé : `z-ai/glm-5.3-flash`.

## 2. Prérequis

- **Node.js 22.13.0 ou plus récent** (voir `.nvmrc` et `engines` dans `package.json`) et npm.
- Une **clé API OpenRouter** (https://openrouter.ai/keys) avec du crédit. Un run complet sur le cas d'entraînement annonce un coût d'environ 0,015 à 0,075 $ ; il varie selon le fournisseur amont.
- Aucun autre logiciel : les lecteurs PDF, Office et OCR sont des paquets npm, et les données de langue de l'OCR sont fournies avec eux (aucun téléchargement à l'exécution).

## 3. Démarrage rapide

```bash
npm install
npm run harness:setup        # crée .env depuis .env.example (n'écrase jamais un .env existant)
```

Ouvrez `.env` et collez votre clé après `OPENROUTER_API_KEY=`. Ne modifiez pas `OPENROUTER_MODEL` : les règles du cas imposent le modèle.

```bash
npm run harness:doctor       # vérifie tout ; chaque ligne doit être PASS (WARN est informatif)
npm run dev
```

Ouvrez l'URL affichée par le serveur de développement suivie de `/workspace` (par défaut `http://localhost:3000/workspace`) et cliquez sur **Start analysis**. La page affiche le score, la durée et le coût estimé.

Au démarrage, `npm run dev` lit et océrise automatiquement la data room. Le terminal affiche alors une ligne du type `[doc-harness] ingested 30 files in … ms (… from cache)`.

## 4. Les commandes utilitaires

| Commande | Rôle |
|---|---|
| `npm run harness:setup` | Crée `.env` depuis `.env.example` s'il manque. Si `OPENROUTER_API_KEY` est exportée dans votre shell et vide dans `.env`, elle l'y enregistre. La clé n'est jamais affichée. |
| `npm run harness:doctor` | Vérifie Node.js, les dépendances, la clé, les réglages de proxy, le compte OpenRouter (clé valide, crédit restant) et la disponibilité du modèle, la data room, l'ingestion et le questionnaire. Affiche `PASS` / `WARN` / `FAIL` avec un correctif pour chaque problème ; code de sortie 1 en cas d'échec. Les deux vérifications OpenRouter sont gratuites (elles n'appellent pas le modèle). |
| `npm run harness:doctor -- --offline` | Mêmes vérifications, sans aucun appel réseau. |
| `npm run harness:answer` | Exécute toute la chaîne en ligne de commande (sans navigateur, sans notation) et écrit exactement le JSON renvoyé par l'API dans `outputs/answers-<horodatage>.json`. Valide le fichier contre le schéma officiel ; code de sortie 1 s'il est invalide. À utiliser pour un cas sans corrigé. |
| `npm run harness:api` | Envoie le questionnaire à un `npm run dev` en cours, sur `/api/answer` : le même chemin que la page workspace et que l'évaluateur. Enregistre la réponse dans `outputs/api-<horodatage>.json`, la valide, et la note avec la règle de la page workspace si un corrigé existe. |
| `npm run harness:eval` | Exécute la chaîne dans Node et affiche une matrice question par question comparée au corrigé : valeur, sources, manière dont chaque réponse a été décidée, et durée de chaque appel. Écrit `outputs/eval-<horodatage>.json` (sortie, trace et score). |
| `npm run harness:ingest` | Montre ce que les lecteurs ont extrait de chaque fichier : nombre de blocs, tokens estimés, confiance OCR et avertissements. |
| `npm run harness:ingest -- <fileId>` | Affiche un document exactement tel que le modèle le voit. |
| `npm run harness:probe` | Petits tests payants des capacités du modèle (mode JSON, raisonnement, appels d'outils, image en entrée, cache de prompt), pour environ 0,001 à 0,002 $. |

Options (à passer après `--`) :

```bash
npm run harness:answer -- --playbook path/to/questions.json --out answers.json --trace trace.json
npm run harness:api -- --url http://localhost:3000 --playbook data/playbook/questions.json --key data/playbook/expected-output.json
npm run harness:api -- --no-score --out outputs/api.json
npm run harness:eval -- --questions q_001,q_012 --batch-size 4 --reasoning medium --no-escalation --no-triage
```

`harness:eval` accepte aussi `--agent-reasoning <niveau>`, `--playbook <chemin>` et `--key <chemin>`. Les niveaux de raisonnement sont `off`, `low`, `medium` et `high`. Le modèle ne permet pas de couper le raisonnement : `off` est donc envoyé comme effort minimal.

## 5. Lancer un nouveau cas

1. Remplacez les pièces dans `data/case/files/` et mettez à jour `data/case/manifest.json` (une entrée par fichier : `fileId` et `format`).
2. Remplacez `data/playbook/questions.json`. Ajoutez `data/playbook/expected-output.json` seulement si vous avez un corrigé ; sans corrigé, `harness:answer` et `harness:api -- --no-score` fonctionnent quand même.
3. Lancez `npm run harness:doctor`. Il confirme que chaque fichier listé existe, que chaque fichier produit du texte et que le questionnaire est valide.
4. Exécutez le cas dans le navigateur (`npm run dev`, puis `/workspace`) ou avec `npm run harness:answer`.

Remarques :
- Rien dans le code ne dépend des fichiers d'entraînement. Les noms de fichiers, les entités et les valeurs sont tous lus dans la data room.
- Le cache de lecture `.cache/doc-harness/` est indexé par le contenu des fichiers : un fichier renommé ou remplacé n'est jamais servi périmé. Supprimer `.cache/` est toujours sans risque ; la prochaine ingestion est seulement plus lente.
- Pendant que `npm run dev` tourne, toute modification du manifeste ou de `data/case/files/` relance automatiquement l'ingestion.

## 6. Configuration

Variables d'environnement (dans `.env` ou dans votre shell) :

| Variable | Rôle |
|---|---|
| `OPENROUTER_API_KEY` | Obligatoire. Votre clé OpenRouter. |
| `OPENROUTER_MODEL` | Déjà réglée à `z-ai/glm-5.3-flash` dans `.env.example`. À conserver : les règles du cas imposent le modèle. |
| `OPENROUTER_BASE_URL` | Facultative. Une URL de base compatible OpenRouter, uniquement pour les réseaux où le serveur de développement ne peut pas joindre `openrouter.ai` directement (voir §8). |
| `NODE_USE_ENV_PROXY=1` | Facultative, derrière un proxy HTTPS : permet aux commandes Node `harness:*` d'utiliser `HTTPS_PROXY`. |

Les réglages par défaut de la chaîne sont dans `lib/harness/application/config.ts` :

| Réglage | Défaut | Signification |
|---|---|---|
| `batchSize` | 6 | questions par appel au modèle (les questions liées sont regroupées) |
| `concurrency` | 20 | nombre maximal d'appels en parallèle |
| `dossierTokenBudget` | 60000 | au-delà de ce nombre de tokens de documents pertinents, chaque appel reçoit des extraits retrouvés plutôt que les documents complets |
| `answerReasoning` | `"low"` | effort de raisonnement des appels de réponse |
| `consistency` | `true` | lance une seconde passe indépendante et tranche les désaccords |
| `consistencyGraceMs` | 5000 | attente de la seconde passe une fois la première terminée |
| `adjudicationBudgetMs` | 40000 | budget de temps pour trancher les désaccords |
| `escalation` | `true` | envoie les réponses signalées à l'agent outillé |
| `escalationBudgetMs` | 20000 | budget de temps de la phase agent |
| `hedgeAfterMs` / `maxHedges` | 7000 / 2 | un appel encore en attente après 7 s (puis 14 s) est dupliqué ; la première réponse l'emporte |
| `deadlineMs` | 150000 | échéance souple d'un run |

## 7. Sorties et traces

- `outputs/` contient les fichiers écrits par `harness:answer`, `harness:api` et `harness:eval`. Il est ignoré par git.
- `.cache/doc-harness/` contient les documents lus, indexés par empreinte de contenu. Il est ignoré par git.
- Lors des runs dans le navigateur, la trace complète du dernier run (justification par question, signalements, appels, coûts) est enregistrée dans le cache SQLite local de l'application, sous la clé `doc-harness:trace:<caseId>`. Le terminal du serveur de développement affiche aussi une ligne de résumé par run, commençant par `[doc-harness] done in`.
- `harness:answer -- --trace <fichier>` écrit la même trace dans un fichier.

## 8. Dépannage

| Symptôme | Cause et solution |
|---|---|
| La page workspace affiche `OPENROUTER_API_KEY is not set: copy .env.example to .env and add your key` | Aucune clé n'a atteint le serveur de développement. Lancez `npm run harness:setup`, remplissez `.env`, puis relancez `npm run dev`. |
| `harness:answer` affiche `` harness:answer failed: OPENROUTER_API_KEY is not set: run `npm run harness:setup` and put your OpenRouter key in .env `` | Même solution que ci-dessus. |
| `harness:eval` affiche `OPENROUTER_API_KEY is not set (environment or .env)` | Même solution que ci-dessus. |
| `harness:doctor` signale `OpenRouter account … key rejected (HTTP 401)` | La clé est fausse ou révoquée. Recopiez-la depuis openrouter.ai/keys. |
| `harness:doctor` signale `cannot reach https://openrouter.ai/api/v1` | Pas d'accès internet, ou un proxy HTTPS. Derrière un proxy, exportez `NODE_USE_ENV_PROXY=1` pour les commandes `harness:*`. |
| Derrière un proxy, les runs dans le navigateur ne renvoient que des réponses `null` et le journal du serveur affiche `DNS lookup failed` | Le runtime worker utilisé par `npm run dev` ne sait pas passer par un proxy HTTP. Réglez `OPENROUTER_BASE_URL` sur un relais compatible OpenRouter capable de joindre `openrouter.ai`. |
| `harness:api` affiche `` could not reach http://localhost:3000/api/answer (ECONNREFUSED): is `npm run dev` running? `` | Démarrez d'abord `npm run dev`, ou passez `--url` avec l'URL qu'il a affichée. |
| Un run prend 60 à 90 s au lieu des 15 à 45 s habituelles | OpenRouter envoie chaque appel vers l'un de plusieurs fournisseurs amont, dont l'un est bien plus lent pour ce modèle. Le harness duplique les appels lents, mais il ne peut pas choisir le fournisseur : les règles du cas imposent la politique de fournisseur. |
| `harness:doctor` signale une confiance OCR faible | Ces images (jusqu'à 4 Mo chacune) sont aussi envoyées à l'entrée image du modèle pendant un run : leur texte est donc tout de même lu. |

## 9. Tests

```bash
npm run test:unit         # tests unitaires (node:test)
npm run test:bdd          # scénarios d'acceptation hors ligne (Gherkin, modèle scripté ; ni clé ni réseau)
npm run test:bdd:live     # validation d'acceptation en conditions réelles sur le cas d'entraînement (clé requise ; ≥ 46/50, < 0,10 $, < 45 s ;
                          # la limite de durée peut échouer quand les appels tombent sur le fournisseur lent, voir §8)
npm test                  # build de production + tests d'origine + unitaires + scénarios hors ligne
npm run lint
```
