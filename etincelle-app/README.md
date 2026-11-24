# Étincelle — Application de Rencontre Full-Stack (Prête à Héberger)

Application complète avec **création de comptes**, **upload de photos**, **base de données persistante (SQLite)**, **système de swipe avec matchs mutuels** et **messagerie instantanée en temps réel (Socket.IO)**.

## Structure du projet
- `server.js` : Serveur Node.js / Express + API REST + WebSockets + Base SQLite.
- `public/index.html` : Interface utilisateur complète (inscription, connexion, swipe tactile, chat, profil).
- `package.json` : Dépendances du projet.
- `Dockerfile` : Pour déploiement conteneurisé rapide.

## Lancer en local (sur ton ordinateur)
1. Installe [Node.js](https://nodejs.org/) (version 18 ou supérieure).
2. Ouvre un terminal dans le dossier du projet et lance :
   ```bash
   npm install
   npm start
   ```
3. Ouvre **http://localhost:3000** dans ton navigateur.

## Héberger le site en ligne (gratuit / simple)
1. Crée un dépôt GitHub privé ou public et pousse ces fichiers dessus.
2. Connecte ton dépôt sur **Render.com**, **Railway.app** ou **Fly.io** :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
3. Ajoute la variable d'environnement `JWT_SECRET` avec une phrase secrète longue.
4. *(Important pour la production)* : Monte un disque persistant sur `/app/data` et `/app/uploads` afin de conserver les comptes et photos lors des redémarrages du serveur.
