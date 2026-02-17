# OpenTalk — Parler sans déranger (Starter)

Ce dossier contient une **version 1** d’OpenTalk (web) pensée pour être :
- **texte uniquement** (pas d’images)
- **18+**
- statuts **🟢 / 🟡 / 🔴**
- demandes de discussion avec réponse rapide
- chat 1–1 + groupes
- **🔴 bouton stop** (blocage instantané)
- filtre anti-vulgarité/sexualisation (client + règles côté base)
- reconfirmation hebdomadaire (7 jours) de la visibilité

## 0) Ce qu’il te faut
- Un compte Google (pour Firebase)
- Un compte GitHub (optionnel mais recommandé)

## 1) Créer la base gratuite (Firebase)
1. Va sur Firebase Console et crée un projet `opentalk`.
2. Active **Authentication** → Email/Password.
3. Crée une base **Cloud Firestore** (mode production).
4. Dans **Project settings** → **Web app** → copie la config Firebase (apiKey, etc.)
5. Colle cette config dans `public/js/firebase-config.js` (fichier prévu).

## 2) Déployer gratuitement (Cloudflare Pages OU GitHub Pages)
### Option A — Cloudflare Pages (recommandé)
- Crée un nouveau projet Pages à partir de ton repo GitHub
- Choisis `public/` comme dossier de build (c’est un site statique)

### Option B — GitHub Pages
- Mets le contenu du dossier `public/` dans la branche `gh-pages` ou dans `/docs`
- Active GitHub Pages dans Settings

## 3) Sécurité (important)
- Copie/colle les règles Firestore depuis `firebase/firestore.rules`
- Ajuste si besoin
- Le filtre client est un 1er rempart, mais **les règles** et la **modération** sont clés

## 4) Fichiers
- `public/index.html` : page d’accueil
- `public/app.html` : application
- `public/js/app.js` : logique (auth, statuts, demandes, chats, groupes, blocage)
- `firebase/firestore.rules` : règles Firestore

## 5) Ce que fait V1 (et limites)
✅ Fonctionnel pour un lancement privé (20–100 personnes)  
⚠️ Pour une vraie montée en charge : ajouter une modération plus fine et un vrai service anti-abus côté serveur.

Bon lancement ☕🦋
