# Étincelle — Application de Rencontres Authentiques

## Contenu de l'archive `.zip`
- `index.html` : Application web complète, autonome et prête à l'emploi (double-cliquez simplement dessus pour l'ouvrir dans n'importe quel navigateur, ou hébergez-la sur Netlify / Vercel / GitHub Pages).
- `README.md` : Guide de déploiement, personnalisation des vraies photos et fonctionnement de la traduction automatique mondiale.

## 1. Des photos naturelles et authentiques (zéro rendu IA)
- Chaque profil dispose de **4 photographies naturelles** (portraits en lumière du jour + moments de vie réels : cafés, plages, randonnées, sorties entre amis) avec traitement colorimétrique naturel (`contrast(0.98) saturate(0.96)`).
- **Gestionnaire de Vraies Photos intégré** : Dans l'onglet **Profil**, utilisez l'outil *Gestionnaire de Vraies Photos (Mode Propriétaire)* pour importer directement vos propres fichiers `.jpg`/`.png`/`.webp` depuis votre ordinateur ou téléphone.

## 2. Traduction automatique selon le pays de connexion
L'application détecte automatiquement le pays et la langue de chaque visiteur dès son arrivée :
1. **Détection instantanée (< 1 ms)** via la langue du navigateur (`navigator.language`) et le fuseau horaire (`Intl.DateTimeFormat`).
2. **Géolocalisation IP automatique** via `ipapi.co/json/` pour identifier le code pays (`FR`, `ES`, `US`, `GB`, `DE`, `IT`, `PT`, `BR`, `MA`, `SA`, `JP`, `CN`, etc.) et basculer immédiatement l'interface dans la langue correspondante (avec support automatique droite-à-gauche `RTL` pour l'arabe).
3. **Sélecteur manuel** disponible à tout moment en haut de l'écran.

## 3. Monétisation & Abonnements intégrés
- **Plan Gratuit** : limité à **5 likes** et **3 messages** par jour, avec floutage des 6 admirateurs dans l'onglet *Likes*.
- **Étincelle Plus (9,99 €/mois)**, **Étincelle Gold (19,99 €/mois)** et **Étincelle VIP (29,99 €/mois)** avec tarifs dégressifs (Mensuel, 3 mois -30%, 12 mois -50%).
