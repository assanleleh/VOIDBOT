# 🚀 Quick Start - Configuration Rapide

Guide rapide pour configurer VOIDBOT, VOIDRPBoutique et VRP_Launcher avec vos configurations.

## 📋 Vos Configurations

Vous avez déjà :
- ✅ `APP_ID` (Client ID) : `1463895378758729728`
- ✅ `DISCORD_TOKEN` : `<YOUR_DISCORD_TOKEN>`
- ✅ `DISCORD_CLIENT_SECRET` : `F-VZNq7KZj36GB8NIMhklgOCfsuAbiBa`
- ✅ `SERVER_ID` (Guild ID) : `1463894282296627294`
- ✅ `ALPHA_TESTER_ROLE_ID` : `1464749809834524915`
- ✅ `WHITELIST_ROLE_ID` : `1463898078904979651`

## 1️⃣ VOIDBOT - Configuration

### 1.1 Créer `.env.dev`

```bash
cd /home/npapash/home/VoidRP/VOIDBOT
nano .env.dev
```

**Contenu :**
```env
# Bot Token
DISCORD_TOKEN=<YOUR_DISCORD_TOKEN>

# OAuth Configuration
CLIENT_ID=1463895378758729728
DISCORD_CLIENT_ID=1463895378758729728
DISCORD_CLIENT_SECRET=<YOUR_DISCORD_CLIENT_SECRET>
DISCORD_REDIRECT_URI=http://localhost:3005/api/auth/discord/callback
FRONTEND_URL=http://localhost:5173

# Node Environment
NODE_ENV=development
```

### 1.2 Créer `src/config.development.json`

```bash
nano src/config.development.json
```

**Contenu minimal (pour faire fonctionner le launcher et la boutique) :**
```json
{
  "whitelistApplyGuildId": "1463894282296627294",
  "alphaRoleId": "1464749809834524915",
  "betaRoleId": null,
  "whitelistRoleId": "1463898078904979651",
  "apiPort": 3005
}
```

**Note :** Vous pouvez laisser les autres champs vides ou avec des valeurs par défaut. Le bot gère gracieusement les configurations manquantes.

### 1.3 Démarrer VOIDBOT

```bash
# Avec Docker
docker-compose -f docker-compose.dev.yml up -d

# Ou sans Docker
npm install
npm start
```

### 1.4 Vérifier que VOIDBOT fonctionne

```bash
curl http://localhost:3005/
# Devrait retourner : "VOIDBOT API Online"
```

---

## 2️⃣ VOIDRPBoutique - Configuration

### 2.1 Backend - Créer `.env.dev`

```bash
cd /home/npapash/home/VoidRP/VOIDRPBoutique/backend
nano .env.dev
```

**Contenu minimal :**
```env
# Server
PORT=3000
NODE_ENV=development

# Database (vous devrez configurer PostgreSQL)
DATABASE_URL=postgresql://postgres:password@localhost:5432/voidrp?schema=public

# VOIDBOT Integration
VOIDBOT_API_URL=http://localhost:3005
DISCORD_REDIRECT_URI=http://localhost:5173/api/auth/discord/callback
FRONTEND_URL=http://localhost:5173

# JWT Secrets (générez des secrets aléatoires)
ACCESS_TOKEN_SECRET=your_random_secret_here_min_32_chars
REFRESH_TOKEN_SECRET=your_random_refresh_secret_here_min_32_chars
JWT_EXPIRES_IN=15m

# CORS
CORS_ORIGIN=http://localhost:5173
```

**Pour générer des secrets JWT :**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2.2 Frontend - Créer `.env.dev`

```bash
cd /home/npapash/home/VoidRP/VOIDRPBoutique/frontend
nano .env.dev
```

**Contenu :**
```env
VITE_API_URL=http://localhost:3000/api
```

### 2.3 Démarrer VOIDRPBoutique

```bash
# Backend
cd backend
npm install
npm run dev

# Frontend (dans un autre terminal)
cd frontend
npm install
npm run dev
```

---

## 3️⃣ VRP_Launcher - Configuration

### 3.1 Créer `.env.dev`

```bash
cd /home/npapash/home/VoidRP/VRP_Launcher
nano .env.dev
```

**Contenu :**
```env
VITE_VOIDBOT_API_URL=http://localhost:3005
```

### 3.2 Démarrer VRP_Launcher

```bash
# Installer les dépendances
npm install

# Démarrer (selon votre setup)
npm run dev
# ou
npm run electron:dev
```

---

## ✅ Checklist

### VOIDBOT
- [ ] `.env.dev` créé avec toutes les variables
- [ ] `src/config.development.json` créé avec les IDs
- [ ] VOIDBOT démarre sans erreur
- [ ] API accessible sur `http://localhost:3005`

### VOIDRPBoutique
- [ ] Backend `.env.dev` créé
- [ ] Frontend `.env.dev` créé
- [ ] PostgreSQL configuré et démarré
- [ ] `npx prisma migrate dev` exécuté (pour créer les tables)
- [ ] Backend accessible sur `http://localhost:3000`
- [ ] Frontend accessible sur `http://localhost:5173`

### VRP_Launcher
- [ ] `.env.dev` créé
- [ ] Launcher démarre sans erreur

---

## 🧪 Test Rapide

### 1. Tester VOIDBOT
```bash
curl http://localhost:3005/
curl http://localhost:3005/api/hello
```

### 2. Tester VOIDRPBoutique
1. Ouvrez `http://localhost:5173`
2. Cliquez sur "Se connecter avec Discord"
3. Vous devriez être redirigé vers Discord OAuth
4. Après autorisation, vous devriez être connecté

### 3. Tester VRP_Launcher
1. Démarrez le launcher
2. Cliquez sur "Se connecter avec Discord"
3. Vous devriez être redirigé vers Discord OAuth
4. Après autorisation, vous devriez être connecté

---

## ⚠️ Points Importants

1. **Discord Developer Portal** : Assurez-vous d'avoir ajouté ces URLs de callback dans "OAuth2" → "Redirects" :
   - `http://localhost:3005/api/auth/discord/callback`
   - `http://localhost:5173/api/auth/discord/callback`
   - `http://localhost:5173/auth/callback`

2. **Ordre de démarrage** : Démarrez VOIDBOT en premier, puis VOIDRPBoutique, puis VRP_Launcher

3. **PostgreSQL** : Si vous n'avez pas encore configuré PostgreSQL pour VOIDRPBoutique, vous pouvez utiliser Docker :
   ```bash
   docker run -d --name postgres-dev -e POSTGRES_PASSWORD=password -e POSTGRES_DB=voidrp -p 5432:5432 postgres:15
   ```

4. **Prisma Migrations** : Après avoir configuré PostgreSQL, exécutez :
   ```bash
   cd VOIDRPBoutique/backend
   npx prisma migrate dev
   ```

---

## 🐛 Dépannage

### VOIDBOT ne démarre pas
- Vérifiez que le token Discord est correct
- Vérifiez les logs : `docker-compose -f docker-compose.dev.yml logs -f`

### VOIDRPBoutique ne peut pas se connecter à VOIDBOT
- Vérifiez que VOIDBOT est démarré : `curl http://localhost:3005/`
- Vérifiez que `VOIDBOT_API_URL` dans `.env.dev` est correct

### Erreur OAuth "redirect_uri_mismatch"
- Vérifiez que les URLs de callback sont exactement les mêmes dans Discord Developer Portal et dans vos `.env`
- Pas de trailing slash `/` à la fin des URLs

