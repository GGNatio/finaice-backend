# Backend FinAIce - Powens OAuth

Backend Node.js/Express pour gérer l'authentification OAuth Powens et les appels API sécurisés.

## Installation

```bash
cd backend
npm install
```

## Configuration

1. Créer un fichier `.env` dans le dossier `backend/` :

```bash
cp .env.example .env
```

2. Remplir les variables d'environnement :

```env
# Powens API Configuration
POWENS_CLIENT_ID=96920760
POWENS_CLIENT_SECRET=8JREhUoE1vJqEoWmc/x33oClqCPMu6mE
POWENS_API_URL=https://sandbox.biapi.pro/2.0
POWENS_AUTH_URL=https://sandbox.biapi.pro
POWENS_REDIRECT_URI=https://your-domain.com/auth/callback

# Supabase Configuration
SUPABASE_URL=https://llamojnlmatwxawqbovg.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key_here

# Server Configuration
PORT=3000
NODE_ENV=development
```

**IMPORTANT** : Mettez à jour `POWENS_REDIRECT_URI` avec votre URL HTTPS de production ou utilisez ngrok pour le développement :

```bash
ngrok http 3000
# Copiez l'URL HTTPS fournie (ex: https://abc123.ngrok.io)
# Mettez à jour POWENS_REDIRECT_URI=https://abc123.ngrok.io/auth/callback
```

3. Créer les tables Supabase :

Exécutez le script SQL dans l'interface Supabase :
```sql
-- Voir SUPABASE_OAUTH_SCHEMA.sql
```

## Démarrage

```bash
# Mode développement
npm run dev

# Mode production
npm start
```

Le serveur démarre sur http://localhost:3000

## Endpoints API

### GET /health
Health check du serveur

### GET /powens/auth?userId={userId}
Génère l'URL OAuth pour connecter une banque
- **Params** : `userId` (UUID)
- **Response** : `{ authUrl, state, powensUserId }`

### POST /powens/exchange
Échange le code OAuth contre un access token
- **Body** : `{ code, state, userId }`
- **Response** : `{ success: true, message: 'Bank connection successful' }`

### GET /powens/accounts/:userId
Récupère les comptes bancaires de l'utilisateur
- **Params** : `userId` (UUID)
- **Response** : Liste des comptes

### GET /powens/transactions/:userId
Récupère les transactions de l'utilisateur
- **Params** : `userId` (UUID)
- **Query** : `accountId`, `from`, `to`, `limit`
- **Response** : Liste des transactions

### POST /powens/sync/:userId
Synchronise manuellement les données Powens
- **Params** : `userId` (UUID)
- **Response** : `{ success: true, message: 'Data synced successfully' }`

### POST /powens/webhook
Webhook Powens pour les événements en temps réel
- **Body** : Event Powens
- **Response** : `{ received: true }`

## Flow OAuth

1. **Frontend** : L'utilisateur clique sur "Connecter une banque"
2. **Backend** : `GET /powens/auth` génère l'URL OAuth avec state (CSRF protection)
3. **Frontend** : Ouvre l'URL OAuth dans `expo-web-browser`
4. **Powens** : L'utilisateur s'authentifie et autorise l'accès
5. **Powens** : Redirige vers `redirect_uri` avec `code` et `state`
6. **Frontend** : Récupère le code et appelle `POST /powens/exchange`
7. **Backend** : Échange le code contre un token, le stocke dans Supabase
8. **Backend** : Récupère automatiquement les comptes et transactions
9. **Frontend** : Affiche les données dans l'app

## Sécurité

- ✅ CSRF Protection via `state` parameter
- ✅ Tokens stockés côté backend uniquement
- ✅ Row Level Security (RLS) sur Supabase
- ✅ HTTPS obligatoire pour redirect_uri en production
- ✅ Service key Supabase (pas anon key)

## Webhooks Powens (optionnel)

Pour recevoir les événements en temps réel (nouvelles transactions, etc.) :

1. Configurez l'URL webhook dans votre compte Powens : `https://your-domain.com/powens/webhook`
2. Vérifiez les signatures webhook (à implémenter)
3. Le backend gère automatiquement les événements

## Développement local avec ngrok

Pour tester le flow OAuth en local :

```bash
# Terminal 1 : Démarrer le backend
npm run dev

# Terminal 2 : Démarrer ngrok
ngrok http 3000

# Copier l'URL HTTPS (ex: https://abc123.ngrok.io)
# Mettre à jour .env : POWENS_REDIRECT_URI=https://abc123.ngrok.io/auth/callback
```

## Production

1. Déployez sur un service cloud (Heroku, Railway, Render, etc.)
2. Obtenez une URL HTTPS
3. Mettez à jour `POWENS_REDIRECT_URI` dans .env
4. Configurez les variables d'environnement sur votre plateforme
5. Mettez à jour `EXPO_PUBLIC_API_BASE_URL` dans le .env de l'app Expo

## Troubleshooting

**Erreur 404 sur /auth/token** :
- Vérifiez que `POWENS_AUTH_URL` est correct
- Assurez-vous que le `code` OAuth n'a pas expiré (1 minute)

**État OAuth invalide** :
- Le `state` a peut-être expiré (10 minutes)
- Vérifiez l'horloge du serveur

**Tokens expirés** :
- Le backend rafraîchit automatiquement les tokens
- Si ça échoue, l'utilisateur doit se reconnecter

**Webhook ne fonctionne pas** :
- Vérifiez l'URL dans les paramètres Powens
- Vérifiez les logs du serveur
- Testez avec un outil comme webhook.site
