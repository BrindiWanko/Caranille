# 🌿 Caranille

**Français** · [English](#english)

> 🎮 Un moteur de **MMORPG 2D** jouable directement dans le navigateur, avec son **éditeur de monde
> intégré**. Dessinez vos cartes, écrivez vos quêtes, placez vos monstres… et vos joueurs voient
> les changements **en direct**. ✨

Caranille réunit tout ce qu'il faut pour créer et faire vivre un petit monde en ligne : cartes en
tuiles, événements et cinématiques, quêtes, combats en temps réel sur la carte, groupes, guildes,
donjons instanciés et raids. Le tout tourne dans **un seul processus Node.js** avec **une seule
base SQLite** : pas de serveur de base de données à installer. 🚀

---

## 🤖 Un projet fait par une IA

**Caranille a été entièrement conçu et programmé par une intelligence artificielle : [Claude Opus 5.5](https://www.anthropic.com/claude) d'Anthropic**, pilotée via Claude Code. 🧠

- 💻 Le code (serveur, client, éditeur, tests), les générateurs de graphismes et cette documentation
  sont écrits par l'IA, à partir des demandes et des retours de l'humain qui dirige le projet.
- 🧪 Le projet est vérifié par plus de 100 tests automatisés (`npm test`), un test de charge et
  une campagne de test de bout en bout dans le navigateur (voir `TEST-REPORT.md` s'il est présent).
- ⚠️ Comme tout code généré, il mérite d'être relu et testé avant une mise en production : des
  bugs peuvent subsister. Les rapports et corrections sont les bienvenus. 🙏

---

## ✨ En un coup d'œil

| | |
| --- | --- |
| 🗺️ **Éditeur de cartes** | Palette de tuiles A à E, couches automatiques, autotiles, ombres, régions, passabilité, historique des versions |
| 🧩 **Événements** | Pages, conditions, déclencheurs, liste de commandes visuelle, cinématiques (fondu, teinte, flash, tremblement) |
| 📜 **Quêtes** | Étapes, objectifs (parler, vaincre, collecter, atteindre un lieu), récompenses, chapitres, marqueurs « ! » et « ? » |
| ⚔️ **Combat** | Temps réel sur la carte, compétences, états, éléments, critiques, IA des monstres, butin |
| 🎒 **Personnage** | Statistiques, points à répartir, sac en grille, équipement, boutiques, auberge, banque |
| 💬 **Social** | Chat par canaux, messages privés, amis, liste d'ignorés, échanges sécurisés, émotions |
| 🛡️ **Groupes et guildes** | Partage d'XP et de butin, rangs et permissions, banque et journal de guilde, blason généré |
| 🏰 **Donjons et raids** | Une copie de carte par groupe, boss à phases, récompenses hebdomadaires, jets de butin |
| 👑 **Administration** | Tableau de bord, sanctions, outils de jeu, journaux, sauvegardes et restauration |
| 📱 **Mobile** | Joystick, boutons Action / Annuler, compétences en arc, plein écran, installable (PWA) |
| 🌍 **Bilingue** | Interface, jeu et éditeur entièrement en **français** et en **anglais** |

---

## 🎨 Ressources visuelles : 100 % générées

**Toutes les ressources visuelles de Caranille ont été générées par le code du projet** : tilesets,
autotiles, personnages, visages, monstres, boss, objets, icônes, fenêtres, bulles, marqueurs de
quête, blasons de guilde, icône de l'application… 🖌️

- 🧪 Elles sont produites par les générateurs de `assets/generators/` (pixel art dessiné en SVG) à
  chaque `npm run build`.
- 🆓 **Elles ne sont tirées d'aucun pack existant et n'appartiennent à personne** : aucune image
  d'un autre jeu ou d'un autre logiciel n'est utilisée ni redistribuée.
- 🔁 Vous pouvez les régénérer à volonté (`npm run assets:build`), les modifier, ou les remplacer
  par vos propres images via le bouton **Ressources** de l'éditeur.

---

## 🛠️ Technologies

- 🖥️ **Serveur** : TypeScript (strict), Express 5, socket.io 4, better-sqlite3 (seul stockage), vues EJS
- 🌐 **Client** : TypeScript compilé par esbuild, rendu canvas, fenêtres façon RPG classique
- 🧪 **Tests** : `node --test` (plus de 110 tests), test de charge intégré

---

## 📦 Installation

Prérequis : **Node.js 22 ou plus récent** et npm. C'est tout ! 🙌

```bash
npm install
npm run build
```

> 💡 Le fichier `.npmrc` désactive les scripts d'installation des dépendances : SQLite et bcrypt
> sont livrés avec leurs binaires précompilés (Windows, Linux, macOS), aucun outil de compilation
> C++ n'est nécessaire.

`npm run build` génère les graphismes, compile le serveur dans `dist/` et le client dans
`public/build/`.

## ▶️ Lancement

```bash
npm start
```

🌐 Ouvrez <http://localhost:3000>. La base `data/game.db` est créée au premier démarrage, migrée
automatiquement, puis remplie avec le monde de démonstration.

🔧 Pendant le développement, `npm run dev` relance le serveur et recompile le client à chaque
modification.

## 👑 Premier compte administrateur

Le **premier compte inscrit** devient automatiquement administrateur 🎉. Les suivants sont des
joueurs. Un administrateur peut ensuite nommer des modérateurs ou d'autres administrateurs depuis
le panel d'administration (le nouveau rôle s'applique tout de suite, même en jeu).

En production (`NODE_ENV=production`), tant que le serveur n'a aucun compte, l'inscription de ce
premier compte demande un **code d'installation** : il est affiché dans le journal du serveur au
démarrage, ou fixé par la variable `SETUP_CODE`. Personne d'autre ne peut ainsi prendre la place de
l'administrateur sur un serveur fraîchement mis en ligne.

## 🕹️ Jouer

1. 🧙 Inscrivez-vous, créez un personnage (classe, apparence), puis entrez dans le monde.
2. 🚶 Déplacements : flèches ou ZQSD/WASD, clic sur la carte, ou joystick tactile.
3. 🗡️ **Action** (Espace, Z, bouton A) : parler, ouvrir, attaquer devant soi. **F** : attaquer.
   **1 à 8** : barre de raccourcis. **Échap** : menu.
4. 🪟 Fenêtres : Sac (I), Personnage (C), Compétences (K), Quêtes (J), Amis (L), Guilde (G),
   Groupe (P), Carte (M), Options (O). **Entrée** ouvre le chat (`/help` pour les commandes).
5. 🎯 Glissez compétences et objets utilisables sur la barre de raccourcis ; cliquez sur un
   monstre ou un joueur pour le cibler.
6. 👥 Menu d'un joueur (clic dans le monde ou sur son nom dans le chat) : message privé, ami,
   échange, groupe, guilde, **inspecter**, ignorer, **signaler**.

## 🗺️ Prise en main de l'éditeur

L'éditeur s'ouvre en jeu, pour les administrateurs : bouton **Administration** 👑 de la barre de
menu, puis **Ouvrir l'éditeur de cartes**. Les modifications enregistrées sont appliquées en direct
aux joueurs présents. ⚡

- 🧱 **Cartes** : arbre des cartes, palette de tuiles, couches, ombres, régions, outils crayon /
  rectangle / ellipse / remplissage, annuler / rétablir, historique des versions.
- 🚧 **Passabilité** : en mode Passabilité, un clic sur une case la **bloque** ou la **débloque**
  sans toucher aux tuiles (case encadrée = réglage manuel).
- ⚙️ **Propriétés** d'une carte : nom affiché, taille, tileset, type, **PvP**, **instance**,
  musique, fond, et **monstres de la carte**.
- 🧩 **Événements** : double-clic sur une case en mode Événements. Événements rapides (PNJ, coffre,
  téléporteur…) ou éditeur complet (pages, conditions, apparence, déplacement, déclencheur, liste
  de commandes).
- 📚 **Base de données** : classes, compétences, objets, armes, armures, ennemis, états,
  animations, événements communs, quêtes, raids, interrupteurs et variables, Système et Termes.
  Export / import JSON.
- 🖼️ **Ressources** : import de vos images et sons ; **Importer un projet** pour les cartes et
  données au format de fichiers standard.

## 🛡️ Panel d'administration

Page `/admin`, réservée aux modérateurs et administrateurs :

- 📊 Tableau de bord (joueurs connectés, charge du serveur, cartes et instances actives)
- 👤 Comptes (rôles, bannissements, sourdine, déconnexion, réinitialisation du mot de passe)
- 🧰 Outils de jeu (téléportation, invisibilité, objets et or, interrupteurs, annonces)
- 📝 Journaux (connexions, échanges, ventes, butins rares, signalements, actions d'administration)
- 💾 Sauvegarde et restauration de la base

## 🌳 Monde de démonstration

Une base neuve contient : 🏘️ le village de Caranille (PNJ, boutique, auberge, banque, coffre),
🌲 la forêt de Bruyère (monstres, herbes, cinématique), 🏠 une maison, 🦇 la **grotte de Bruyère**
(donjon instancié) avec le 👺 **roi gobelin**, boss du raid, et le 📖 **chapitre 1** (quêtes
enchaînées).

- 🔄 Pour repartir d'un monde neuf : arrêtez le serveur, renommez ou supprimez `data/game.db`
  (et ses fichiers `-wal` / `-shm`), puis relancez.
- 📤 `npm run demo:export` écrit le monde de démonstration en JSON dans `demo/`.

## ⚙️ Configuration

Variables d'environnement (toutes facultatives) :

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Adresse d'écoute |
| `DB_PATH` | `data/game.db` | Fichier SQLite |
| `NODE_ENV` | — | `production` : cookies sécurisés, HSTS, cache |
| `SESSION_SECRET` | généré et stocké | Secret des sessions |
| `TRUST_PROXY` | — | `1` derrière un proxy inverse (obligatoire : sinon tous les joueurs partagent l'IP du proxy pour la limitation des connexions) |
| `SETUP_CODE` | aléatoire en production | Code demandé à l'inscription du premier compte (administrateur) |
| `MAX_CHARACTERS` | `4` | Personnages par compte |
| `BACKUP_HOURS` / `BACKUP_KEEP` | `6` / `10` | Sauvegardes automatiques dans `data/backups/` |

Les réglages de jeu (titre, monnaie, position de départ, niveau max, groupes, guildes, sac…) se
font dans l'onglet **Système** de l'éditeur.

## 🧪 Tests

```bash
npm test                     # noms interdits, traductions FR/EN, puis tous les tests
npm run typecheck            # vérification TypeScript du serveur, du client et des outils
npm run load-test -- 80 15   # 80 clients simulés pendant 15 s
```

## 🚀 Déploiement

Exemple sur un serveur Linux avec nginx, HTTPS (Let's Encrypt) et pm2 :

```bash
npm ci
npm run build
NODE_ENV=production TRUST_PROXY=1 PORT=3000 npx pm2 start dist/server/index.js --name caranille
npx pm2 save
```

Configuration nginx (les WebSockets doivent passer) :

```nginx
server {
  server_name jeu.example.org;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  client_max_body_size 200m; # imports de projets et restaurations
}
```

🔒 Puis `certbot --nginx -d jeu.example.org` pour le certificat HTTPS. 💾 Pensez à sauvegarder
`data/` (base et `data/backups/`) et `uploads/` (ressources importées).

## 📁 Organisation du code

```
server/   serveur (Express, socket.io, monde, combat, quêtes, social, admin, base SQLite)
client/   client navigateur (moteur de rendu, interface, éditeur, pages)
shared/   types et règles communs (protocole, formats, formules, dessin des graphismes)
assets/   générateurs de graphismes et données générées
views/    pages EJS        locales/  traductions FR/EN        tests/  tests node --test
scripts/  build, développement, test de charge, export de la démo, contrôles
```

📄 Licence du code : [Apache 2.0](LICENSE).

---

<a id="english"></a>

# 🌿 Caranille (English)

> 🎮 A **browser-based 2D MMORPG engine** with a **built-in world editor**. Draw your maps, write
> your quests, place your monsters… and your players see the changes **live**. ✨

Tile maps, events and cutscenes, quests, real-time combat on the map, parties, guilds, instanced
dungeons and raids — all served by **a single Node.js process** with **a single SQLite database**.
No database server to install. 🚀

## 🤖 An AI-made project

**Caranille was entirely designed and written by an artificial intelligence: [Claude Opus 5.5](https://www.anthropic.com/claude) by Anthropic**, driven through Claude Code. 🧠

- 💻 The code (server, client, editor, tests), the graphics generators and this documentation are
  written by the AI, from the requests and feedback of the human directing the project.
- 🧪 It is checked by 100+ automated tests (`npm test`), a load test and an end-to-end test
  campaign in the browser (see `TEST-REPORT.md` when present).
- ⚠️ Like any generated code, review and test it before going to production: bugs may remain.
  Reports and fixes are welcome. 🙏

## ✨ Highlights

- 🗺️ **Map editor**: A–E tile palette, automatic layers, autotiles, shadows, regions, passability, version history
- 🧩 **Events**: pages, conditions, triggers, visual command list, cutscenes
- 📜 **Quests**: steps, objectives, rewards, chapters, "!" and "?" markers
- ⚔️ **Combat**: real time on the map, skills, states, elements, monster AI, loot
- 🎒 **Character**: stats, points, grid bag, equipment, shops, inn, bank
- 💬 **Social**: chat channels, whispers, friends, ignore list, secure trades, emotes
- 🛡️ **Parties & guilds**: shared XP and loot, ranks and permissions, guild bank, generated emblem
- 🏰 **Dungeons & raids**: one map copy per party, boss phases, weekly lockouts, loot rolls
- 👑 **Administration**: dashboard, sanctions, game tools, logs, backups
- 📱 **Mobile**: joystick, Action / Cancel buttons, skill arc, fullscreen, installable (PWA)
- 🌍 **Bilingual**: fully in **French** and **English**

## 🎨 Visual resources: 100% generated

**Every visual resource of Caranille was generated by the project's own code**: tilesets,
autotiles, characters, faces, monsters, bosses, items, icons, windows, balloons, quest markers,
guild emblems, the app icon… 🖌️

- 🧪 They are produced by the generators in `assets/generators/` (pixel art drawn as SVG) at each
  `npm run build`.
- 🆓 **They come from no existing pack and belong to no one**: no image from another game or
  piece of software is used or redistributed.
- 🔁 Regenerate them at will (`npm run assets:build`), change them, or replace them with your own
  images through the editor's **Resources** button.

## 📦 Installation & ▶️ running

Requires **Node.js 22 or newer** and npm. 🙌

```bash
npm install
npm run build
npm start
```

🌐 Open <http://localhost:3000>. `data/game.db` is created, migrated and filled with the demo world
at the first start. `npm run dev` restarts the server and rebuilds the client on every change.
💡 The project's `.npmrc` turns off dependency install scripts: SQLite and bcrypt ship prebuilt
binaries, so no C++ build tools are needed.

## 👑 First administrator account

The **first registered account** automatically becomes an administrator 🎉; later ones are
players. Administrators can promote moderators and other administrators from the administration
panel.

## 🕹️ Playing

🚶 Arrows or WASD (ZQSD on AZERTY), click to walk, or the touch joystick. 🗡️ **Action** (Space, Z,
A button): talk, open, attack ahead. **F**: attack. **1–8**: hotbar. **Escape**: menu. 🪟 Windows:
Bag (I), Character (C), Skills (K), Quests (J), Friends (L), Guild (G), Party (P), Map (M),
Options (O). 💬 **Enter** opens the chat (`/help` lists the commands). 🎯 Drag skills and usable
items onto the hotbar; click a monster or a player to target it; a player's menu offers whisper,
friend, trade, party, guild, **inspect**, ignore and **report**.

## 🗺️ Editor basics

Administrators open the editor in game: **Administration** 👑 button, then **Open the map editor**.
Saved changes are applied live. ⚡ Maps, 🚧 passability (in Passability mode a click **blocks** or
**unblocks** a cell without touching its tiles), ⚙️ map properties (PvP, instance, monsters),
🧩 events, 📚 database (classes, skills, items, enemies, quests, raids, switches…), 🖼️ resources
and project import.

## 🛡️ Administration panel

`/admin`, for moderators and administrators: 📊 dashboard, 👤 accounts and sanctions, 🧰 game
tools, 📝 logs (connections, trades, sales, rare drops, reports, admin actions), 💾 backup and
restore.

## 🌳 Demonstration world

🏘️ The village, 🌲 the forest, 🏠 a house, 🦇 the instanced cave with the 👺 Goblin King raid boss,
and 📖 chapter 1. 🔄 To start again from a fresh world, stop the server, rename or delete
`data/game.db` (and its `-wal` / `-shm` files) and start it again. 📤 `npm run demo:export` writes
the demo as JSON in `demo/`.

## ⚙️ Configuration, 🧪 tests and 🚀 deployment

- Environment variables: `PORT`, `HOST`, `DB_PATH`, `NODE_ENV=production`, `SESSION_SECRET`,
  `TRUST_PROXY=1`, `MAX_CHARACTERS`, `BACKUP_HOURS`, `BACKUP_KEEP`, `SETUP_CODE` (see the table above). Game
  settings live in the editor's **System** tab.
- Tests: `npm test`, `npm run typecheck`, `npm run load-test -- 80 15`.
- Deployment: `npm ci && npm run build`, run with pm2, nginx in front with WebSocket upgrade
  headers (see the configuration above), HTTPS with `certbot --nginx`. 💾 Back up `data/` and
  `uploads/`.

📄 Code license: [Apache 2.0](LICENSE).
