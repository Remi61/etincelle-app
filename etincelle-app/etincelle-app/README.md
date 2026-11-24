# Étincelle v2 — Application de Rencontre Temps Réel & Cloud Permanent

## Nouveautés incluses
1. **Pastille « En ligne » en temps réel** : point vert dynamique sur les cartes de découverte, les likes reçus, la liste des matchs et l'en-tête du chat.
2. **Notification « Quelqu'un t'a liké »** : bannière d'alerte en direct + section *Likes & Brise-glaces reçus* dans l'onglet Messages.
3. **Brise-glace avant le match** : possibilité de réagir directement sur la photo ou la bio d'un membre avant de matcher (le compliment devient automatiquement le premier message du chat dès le match).
4. **Base de données permanente gratuite (PostgreSQL Cloud)** : compatible directement avec **Neon.tech** ou **Supabase** via la variable d'environnement `DATABASE_URL` (avec repli automatique sur SQLite en local).

## Activer la base permanente gratuite (Neon.tech + Render)
1. Crée un projet gratuit sur **neon.tech** et copie ton lien de connexion (`postgresql://...`).
2. Sur **Render.com** → ton service `etincelle-app` → **Environment** → **Add Environment Variable** :
   - **Key** : `DATABASE_URL`
   - **Value** : colle ton lien `postgresql://...`
3. Clique sur **Save, rebuild, and deploy**. Tous les comptes, photos, matchs et messages sont désormais sauvegardés à vie !
