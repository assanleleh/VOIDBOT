# 🤖 Guide de Configuration du Bot Discord VOIDBOT

Guide complet pour configurer votre bot Discord VOIDBOT depuis zéro.

## 📋 Étape 1 : Créer l'Application Discord

### 1.1 Accéder au Developer Portal

1. Allez sur [Discord Developer Portal](https://discord.com/developers/applications)
2. Connectez-vous avec votre compte Discord
3. Cliquez sur **"New Application"** (en haut à droite)
4. Donnez un nom à votre application (ex: "VOIDBOT")
5. Acceptez les conditions et créez l'application

### 1.2 Récupérer le Client ID

1. Dans la page **"General Information"**
2. Copiez le **"Application ID"** (c'est votre `CLIENT_ID`)
3. Notez-le quelque part, vous en aurez besoin

### 1.3 Créer le Bot

1. Dans le menu de gauche, cliquez sur **"Bot"**
2. Cliquez sur **"Add Bot"** ou **"Reset Token"** si le bot existe déjà
3. ⚠️ **Copiez le token immédiatement** (vous ne pourrez plus le voir après)
   - C'est votre `DISCORD_TOKEN`
   - Format : `MTAx...` (longue chaîne de caractères)
4. Activez ces options :
   - ✅ **Public Bot** (si vous voulez que d'autres serveurs l'utilisent)
   - ✅ **Requires OAuth2 Code Grant** (pour l'OAuth)
   - ✅ **Message Content Intent** (si nécessaire)
   - ✅ **Server Members Intent** (obligatoire pour vérifier les rôles)
   - ✅ **Presence Intent** (si vous voulez afficher le statut)

### 1.4 Récupérer le Client Secret (pour OAuth)

1. Dans le menu de gauche, cliquez sur **"OAuth2"**
2. Dans la section **"Client Information"**, copiez le **"Client Secret"**
   - ⚠️ **Ne partagez JAMAIS ce secret publiquement**
   - C'est votre `DISCORD_CLIENT_SECRET`

### 1.5 Configurer les URLs de Callback OAuth

1. Toujours dans **"OAuth2"** → **"Redirects"**
2. Cliquez sur **"Add Redirect"**
3. Ajoutez toutes ces URLs :

```
http://localhost:3005/api/auth/discord/callback
http://localhost:5173/api/auth/discord/callback
http://localhost:5173/auth/callback
http://staging.voidrp.ninja/api/auth/discord/callback
http://staging.voidrp.ninja/auth/callback
https://voidrp.ninja/api/auth/discord/callback
https://voidrp.ninja/auth/callback
```

### 1.6 Activer les Scopes OAuth

Dans **"OAuth2"** → **"Scopes"**, activez :
- ✅ **bot** (pour que le bot fonctionne)
- ✅ **identify** (pour obtenir les infos utilisateur)
- ✅ **email** (pour obtenir l'email)
- ✅ **guilds** (pour obtenir les serveurs)

---

## 📋 Étape 2 : Inviter le Bot sur votre Serveur Discord

### 2.1 Générer l'URL d'invitation

**✅ IMPORTANT :** Pour inviter le bot, vous **N'AVEZ PAS BESOIN** que le bot soit démarré ! L'invitation fonctionne même si le bot est offline. Le bot apparaîtra simplement comme "offline" dans Discord jusqu'à ce que vous le démarriez.

**⚠️ Note importante :** Si vous avez activé **"Bot require OAuth2 Code Grant"** dans les paramètres, désactivez-le ! Cette option est uniquement pour les bots qui utilisent OAuth2 pour l'authentification, pas pour l'invitation standard.

**Méthode 1 : Via Installation (Nouvelle interface Discord)**

1. Dans le menu de gauche, cliquez sur **"Installation"** (ou **"OAuth2"** → **"URL Generator"** selon votre version)
2. Dans la section **"Install App"** ou **"Scopes"** :
   - Sélectionnez le scope : ✅ **bot** (seul)
3. Dans la section **"Bot Permissions"** :
   - Sélectionnez les permissions du bot :
     - ✅ **Read Messages/View Channels**
     - ✅ **Send Messages**
     - ✅ **Manage Messages** (pour les tickets)
     - ✅ **Embed Links**
     - ✅ **Attach Files**
     - ✅ **Read Message History**
     - ✅ **Manage Channels** (pour créer les tickets)
     - ✅ **Manage Roles** (pour vérifier les rôles)
     - ✅ **View Server Members** (obligatoire pour vérifier les rôles)
4. L'URL d'invitation sera générée automatiquement en bas de la page
5. Copiez cette URL

**Méthode 2 : Via OAuth2 → URL Generator (Ancienne interface)**

Si vous voyez encore l'ancienne interface avec "URL Generator" :

1. Dans **"OAuth2"** → **"Redirects"**, ajoutez une redirect URI (si Discord la demande) :
   - Cliquez sur **"Add Redirect"**
   - Ajoutez : `http://localhost:3005/api/auth/discord/callback`
   - ⚠️ **Note** : Cette URL est pour l'OAuth (authentification utilisateur), pas pour l'invitation du bot.
   - Cliquez sur **"Save Changes"**

2. Dans **"OAuth2"** → **"URL Generator"** :
   - Sélectionnez le scope : ✅ **bot** (seul)
   - Sélectionnez les permissions du bot (liste ci-dessus)
   - Si Discord demande une redirect URI, sélectionnez celle que vous venez d'ajouter
   - Copiez l'URL générée

**Méthode 2 : Créer l'URL manuellement (alternative)**

Si Discord continue de demander une redirect URI, vous pouvez créer l'URL manuellement :

1. Récupérez votre **Client ID** (Application ID) depuis "General Information"
2. Calculez les permissions : utilisez [Discord Permissions Calculator](https://discordapi.com/permissions.html)
   - Sélectionnez toutes les permissions listées ci-dessus
   - Copiez le nombre de permissions (ex: `2147483648`)
3. Créez l'URL :
   ```
   https://discord.com/api/oauth2/authorize?client_id=VOTRE_CLIENT_ID&permissions=NOMBRE_PERMISSIONS&scope=bot
   ```
   Remplacez :
   - `VOTRE_CLIENT_ID` par votre Application ID
   - `NOMBRE_PERMISSIONS` par le nombre calculé

**Exemple d'URL complète :**
```
https://discord.com/api/oauth2/authorize?client_id=123456789012345678&permissions=2147483648&scope=bot
```

### 2.2 Inviter le Bot

1. **Vous n'avez PAS besoin de démarrer VOIDBOT** - l'invitation fonctionne même si le bot est offline
2. Ouvrez l'URL copiée dans votre navigateur
3. Sélectionnez votre serveur Discord
4. Autorisez le bot
5. Le bot devrait apparaître dans votre serveur (offline pour l'instant, jusqu'à ce que vous le démarriez)

---

## 📋 Étape 3 : Récupérer les IDs Discord

### 3.1 Activer le Mode Développeur Discord

1. Ouvrez Discord (application ou web)
2. Allez dans **Paramètres** → **Avancé**
3. Activez **"Mode développeur"**

### 3.2 Récupérer les IDs nécessaires

#### Guild ID (ID du Serveur)

1. Clic droit sur votre serveur Discord
2. Cliquez sur **"Copier l'ID du serveur"**
3. Notez cet ID (ex: `1421909011799736416`)

#### Channel IDs (IDs des Salons)

1. Clic droit sur un salon → **"Copier l'ID du salon"**
2. IDs à récupérer :
   - **Salon de bienvenue** (welcomeChannelId)
   - **Salon de logs** (logChannelId)
   - **Salon des résultats whitelist** (whitelistResultChannelId)
   - **Salon pour devenir WL** (whitelistApplyChannelName - juste le nom, pas l'ID)

#### Role IDs (IDs des Rôles)

1. Clic droit sur un rôle → **"Copier l'ID du rôle"**
2. IDs à récupérer :
   - **Rôle Whitelist** (whitelistRoleId)
   - **Rôle Alpha** (alphaRoleId)
   - **Rôle Beta** (betaRoleId - si configuré)
   - **Rôle Support** (staffRoleId pour tickets)
   - **Rôle Mod** (staffRoleId pour signalements)

#### Category ID (ID de la Catégorie)

1. Clic droit sur une catégorie → **"Copier l'ID de la catégorie"**
2. ID pour les tickets (ticketCategoryId)

---

## 📋 Étape 4 : Configurer les Fichiers de Configuration

### 4.1 Configuration Development

```bash
cd /home/npapash/home/VoidRP/VOIDBOT
nano src/config.development.json
```

**Contenu à remplir :**

```json
{
    "ticketCategoryId": "VOTRE_CATEGORY_ID_TICKETS",
    "logChannelId": "VOTRE_CHANNEL_ID_LOGS",
    "panelTitle": "Ouvrir un ticket",
    "panelDescription": "Choisissez un thème pour ouvrir un ticket privé.",
    "panelColor": 5793266,
    "themes": [
        {
            "key": "support",
            "label": "Support",
            "description": "Aide générale",
            "emoji": "🛟",
            "staffRoleId": "VOTRE_ROLE_ID_SUPPORT",
            "welcomeMessage": "Merci de décrire votre demande de support.",
            "color": 5763719
        },
        {
            "key": "report",
            "label": "Signalement",
            "description": "Signaler un utilisateur ou un bug",
            "emoji": "🚨",
            "staffRoleId": "VOTRE_ROLE_ID_MOD",
            "welcomeMessage": "Donnez les détails du signalement.",
            "color": 15548997
        }
    ],
    "welcomeBannerPath": "src/assets/WelcomeBanner.png",
    "welcomeChannelId": "VOTRE_CHANNEL_ID_BIENVENUE",
    "whitelistApplyGuildId": "VOTRE_GUILD_ID",
    "whitelistApplyChannelName": "devenir-wl",
    "whitelistApplyPanelText": "**Comment obtenir la whitelist ?**\n1) Clique sur le bouton ci-dessous.\n2) Remplis le formulaire reçu.\n3) Ton dossier est envoyé et visible dans #salon-resultats.\n4) Passe ton entretien oral avec le staff.\n5) Obtiens ta whitelist si accepté.",
    "whitelistApplyTitle": "Devenir whitelist",
    "whitelistApplyColor": 5763719,
    "whitelistApplyBannerPath": "src/assets/DevenirWhitelist.png",
    "whitelistResultChannelId": "VOTRE_CHANNEL_ID_RESULTATS",
    "whitelistFormChannelName": "formulaire-wl",
    "factionSunaEmoji": "🏜️",
    "whitelistRoleId": "VOTRE_ROLE_ID_WHITELIST",
    "alphaRoleId": "VOTRE_ROLE_ID_ALPHA",
    "betaRoleId": "VOTRE_ROLE_ID_BETA",
    "statusGuildId": "VOTRE_GUILD_ID",
    "statusText": "Veille sur {count} shinobis !",
    "statusType": "Watching",
    "apiPort": 3005
}
```

### 4.2 Configuration Production

```bash
cp src/config.development.json src/config.production.json
nano src/config.production.json
```

Même structure, mais avec les IDs de votre serveur de production (peut être le même serveur).

### 4.3 Configuration Staging (si nécessaire)

```bash
cp src/config.development.json src/config.staging.json
nano src/config.staging.json
```

---

## 📋 Étape 5 : Configurer les Variables d'Environnement

### 5.1 Créer .env.dev

```bash
cd /home/npapash/home/VoidRP/VOIDBOT
nano .env.dev
```

**Contenu :**

```env
# Bot Token (obligatoire)
DISCORD_TOKEN=votre_bot_token_copié_plus_tôt

# OAuth Configuration
CLIENT_ID=votre_application_id
DISCORD_CLIENT_ID=votre_application_id
DISCORD_CLIENT_SECRET=votre_client_secret
DISCORD_REDIRECT_URI=http://localhost:3005/api/auth/discord/callback
FRONTEND_URL=http://localhost:5173

# Node Environment
NODE_ENV=development
```

### 5.2 Créer .env.prod (pour plus tard)

```bash
nano .env.prod
```

Même structure, mais avec les valeurs de production.

---

## 📋 Étape 6 : Tester le Bot

### 6.1 Démarrer le Bot

```bash
cd /home/npapash/home/VoidRP/VOIDBOT
docker-compose -f docker-compose.dev.yml up -d

# Ou sans Docker
npm install
npm start
```

### 6.2 Vérifier la Connexion

1. Le bot devrait apparaître **en ligne** dans votre serveur Discord
2. Vérifiez les logs :
   ```bash
   docker-compose -f docker-compose.dev.yml logs -f
   ```
3. Vous devriez voir : `[Bot] Ready! Logged in as VOIDBOT#1234`

### 6.3 Tester les Commandes

Le bot devrait répondre aux commandes configurées (selon votre `commands.js`).

### 6.4 Tester l'API

```bash
curl http://localhost:3005/
# Devrait retourner : "VOIDBOT API Online"
```

---

## ✅ Checklist Complète

### Discord Developer Portal
- [ ] Application créée
- [ ] Bot créé et token copié
- [ ] Client Secret copié
- [ ] URLs de callback OAuth ajoutées
- [ ] Scopes OAuth activés
- [ ] Bot invité sur le serveur Discord
- [ ] Permissions du bot configurées

### Configuration Fichiers
- [ ] `config.development.json` rempli avec tous les IDs
- [ ] `config.production.json` rempli (si différent)
- [ ] `.env.dev` créé avec token et secrets
- [ ] `.env.prod` créé (pour plus tard)

### Test
- [ ] Bot démarre sans erreur
- [ ] Bot apparaît en ligne sur Discord
- [ ] API accessible sur `http://localhost:3005`
- [ ] Commandes du bot fonctionnent
- [ ] OAuth fonctionne (test avec VOIDRPBoutique)

---

## 🐛 Troubleshooting

### Le bot ne se connecte pas

```bash
# Vérifier le token
# Le token doit commencer par quelque chose comme : MTAx...
# Vérifier qu'il n'y a pas d'espaces avant/après

# Vérifier les logs
docker-compose -f docker-compose.dev.yml logs voidbot-dev
```

### Erreur "Cannot GET /api/auth/discord/callback"

**Symptôme :** Vous voyez "Cannot GET /api/auth/discord/callback" dans votre navigateur.

**Cause :** Vous essayez d'accéder directement à l'URL de callback.

**Solution :**
1. ⚠️ **Cette URL n'est PAS destinée à être visitée directement** - elle est appelée automatiquement par Discord après l'authentification OAuth
2. **Pour l'invitation du bot** : Vous n'avez PAS besoin que VOIDBOT soit démarré. Utilisez simplement l'URL générée dans "URL Generator"
3. **Pour l'OAuth (authentification utilisateur)** : Là oui, VOIDBOT doit être démarré pour gérer le callback. Vérifiez que VOIDBOT tourne :
   ```bash
   # Vérifier si VOIDBOT tourne
   curl http://localhost:3005/api/hello
   # Devrait retourner {"message":"VOIDBOT API is running"}
   ```
   Si VOIDBOT n'est pas démarré :
   ```bash
   cd VOIDBOT
   npm start
   # ou avec Docker
   docker-compose -f docker-compose.dev.yml up -d
   ```
4. La redirect URI `http://localhost:3005/api/auth/discord/callback` est uniquement pour que Discord puisse rediriger vers votre serveur après l'authentification OAuth - vous ne devez jamais l'ouvrir manuellement

### Erreur "Missing Access" ou "Missing Permissions"

- Vérifiez que le bot a les bonnes permissions sur le serveur
- Réinvitez le bot avec toutes les permissions nécessaires

### Erreur "Guild not found"

- Vérifiez que le `whitelistApplyGuildId` correspond à l'ID de votre serveur
- Vérifiez que le bot est bien sur ce serveur

### Erreur "Channel not found"

- Vérifiez que les Channel IDs sont corrects
- Vérifiez que le bot peut voir ces salons

### Erreur "Role not found"

- Vérifiez que les Role IDs sont corrects
- Vérifiez que le bot a la permission "Manage Roles" et est au-dessus du rôle dans la hiérarchie

---

## 📝 Notes Importantes

1. **Token Bot** : Ne jamais commiter dans Git, toujours dans `.env`
2. **Client Secret** : Ne jamais partager publiquement
3. **IDs Discord** : Peuvent être les mêmes entre dev/staging/prod si vous utilisez le même serveur
4. **Permissions** : Le bot doit avoir les permissions nécessaires ET être au-dessus des rôles qu'il doit gérer dans la hiérarchie

---

## 🔗 Liens Utiles

- [Discord Developer Portal](https://discord.com/developers/applications)
- [Discord Permissions Calculator](https://discordapi.com/permissions.html)
- [Discord.js Documentation](https://discord.js.org/)

