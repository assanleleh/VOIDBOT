/**
 * OAuth2 Discord Endpoints pour VOIDBOT
 * Permet d'utiliser VOIDBOT (bot) pour gérer aussi l'authentification OAuth
 */

const axios = require('axios');

/**
 * Setup OAuth routes
 * @param {Express} app - Express app instance
 * @param {Object} config - Configuration object
 * @param {Client} discordClient - Discord.js client instance
 */
function setupOAuthRoutes(app, config, discordClient) {
	// Rate limiting pour OAuth (réutiliser authLimiter si disponible)
	// Rate limiting pour OAuth (réutiliser authLimiter si disponible)
	const authLimiter = (req, res, next) => {
		// Simple rate limiting - peut être amélioré avec express-rate-limit
		// DISABLED IN STAGING
		next();
	};

	// OAuth: Start auth flow
	app.get('/api/auth/discord', authLimiter, (req, res) => {
		const clientId = process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID;
		// Priorité à req.query.redirect_uri (passé dynamiquement) plutôt qu'à DISCORD_REDIRECT_URI (config statique)
		const redirectUri = req.query.redirect_uri || process.env.DISCORD_REDIRECT_URI;
		const forType = req.query.for || 'launcher'; // 'launcher' ou 'boutique'

		if (!clientId) {
			return res.status(500).json({ error: 'Discord OAuth not configured. Missing CLIENT_ID' });
		}

		if (!redirectUri) {
			return res.status(500).json({ error: 'Discord OAuth not configured. Missing redirect_uri (query param or DISCORD_REDIRECT_URI env var)' });
		}

		// Déterminer les scopes et response_type selon le type
		let scope, responseType;
		if (forType === 'boutique') {
			scope = req.query.scope || 'identify email';
			responseType = 'code'; // Authorization Code flow
		} else {
			// Launcher
			scope = req.query.scope || 'identify guilds';
			responseType = 'token'; // Implicit Grant flow
		}

		console.log(`[OAuth] Redirecting to Discord OAuth for ${forType} with redirect_uri: ${redirectUri}`);

		// Encode redirect_uri and other params in state parameter for callback
		const stateData = {
			redirect_uri: redirectUri,
			for: forType,
			frontend_redirect: req.query.frontend_redirect
		};
		const state = Buffer.from(JSON.stringify(stateData)).toString('base64');
		console.log(`[OAuth] State encoded: ${state.substring(0, 50)}...`);

		const authorize = new URL('https://discord.com/api/oauth2/authorize');
		authorize.search = new URLSearchParams({
			client_id: clientId,
			redirect_uri: redirectUri,
			response_type: responseType,
			scope: scope,
			state: state, // Pass state to preserve redirect_uri
			prompt: 'consent',
		}).toString();

		res.redirect(authorize.toString());
	});

	// OAuth: Callback (Authorization Code flow - pour boutique)
	app.get('/api/auth/discord/callback', authLimiter, async (req, res) => {
		const code = req.query.code;
		const error = req.query.error;
		const state = req.query.state;

		// Decode state to get redirect_uri and other params
		let stateData = {};
		if (state) {
			try {
				stateData = JSON.parse(Buffer.from(state, 'base64').toString());
			} catch (e) {
				console.error('[OAuth] Failed to decode state:', e);
			}
		}

		const forType = stateData.for || req.query.for || 'boutique';
		const redirectUri = stateData.redirect_uri || req.query.redirect_uri || process.env.DISCORD_REDIRECT_URI;
		const frontendRedirect = stateData.frontend_redirect || req.query.frontend_redirect;

		console.log(`[OAuth] Callback received - State decoded:`, stateData);
		console.log(`[OAuth] Using redirect_uri for token exchange: ${redirectUri}`);

		if (error) {
			console.error('[OAuth] Discord returned error:', error);
			const frontendUrl = process.env.FRONTEND_URL || frontendRedirect || 'http://localhost:5173';
			return res.redirect(`${frontendUrl}?login=error&reason=${encodeURIComponent(error)}`);
		}

		if (!code) {
			return res.status(400).json({ error: 'Missing authorization code' });
		}

		const clientId = process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID;
		const clientSecret = process.env.DISCORD_CLIENT_SECRET;

		if (!clientId || !clientSecret) {
			return res.status(500).json({ error: 'Discord OAuth not configured. Missing CLIENT_ID or DISCORD_CLIENT_SECRET' });
		}

		if (!redirectUri) {
			console.error('[OAuth] Missing redirect_uri in callback. State:', stateData, 'Query:', req.query);
			return res.status(500).json({ error: 'Discord OAuth not configured. Missing redirect_uri (must match authorization request)' });
		}

		console.log(`[OAuth] Using redirect_uri for token exchange: ${redirectUri}`);

		// Validate OAuth code format
		if (code.length < 20 || code.length > 200 || !/^[a-zA-Z0-9_-]+$/.test(code)) {
			return res.status(400).json({ error: 'Invalid OAuth code format' });
		}

		try {
			// 1. Exchange code for tokens
			const tokenResp = await axios.post('https://discord.com/api/oauth2/token',
				new URLSearchParams({
					client_id: clientId,
					client_secret: clientSecret,
					grant_type: 'authorization_code',
					code: code,
					redirect_uri: redirectUri,
				}),
				{ headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
			);

			if (!tokenResp.data || !tokenResp.data.access_token) {
				return res.status(502).json({ error: 'token_exchange_failed', detail: 'No access token in response' });
			}

			const { access_token } = tokenResp.data;

			// 2. Get User Info
			const userResp = await axios.get('https://discord.com/api/users/@me', {
				headers: { Authorization: `Bearer ${access_token}` }
			});
			const discordUser = userResp.data;
			const userId = discordUser.id;

			// 3. Vérifier les rôles (via bot) - seulement si nécessaire
			// Pour la boutique, on peut skip la vérification de rôle whitelist
			// Pour le launcher, on vérifie
			if (forType === 'launcher' || req.query.check_role === 'true') {
				const guildId = config.whitelistApplyGuildId;
				const roleId = config.whitelistRoleId;

				if (guildId && roleId) {
					const guild = discordClient.guilds.cache.get(guildId) ||
						await discordClient.guilds.fetch(guildId).catch(() => null);

					if (!guild) {
						console.error('[OAuth] Guild not found:', guildId);
						return res.status(500).json({ error: 'Guild error' });
					}

					const member = await guild.members.fetch(userId).catch(() => null);
					if (!member) {
						console.log(`[OAuth] User ${userId} not in guild ${guildId}`);
						const frontendUrl = process.env.FRONTEND_URL || req.query.redirect_uri || 'http://localhost:5173';
						return res.redirect(`${frontendUrl}?login=error&reason=not_in_guild`);
					}

					const hasRole = member.roles.cache.has(roleId);
					if (!hasRole) {
						console.log(`[OAuth] User ${userId} missing required role ${roleId}`);
						const frontendUrl = process.env.FRONTEND_URL || req.query.redirect_uri || 'http://localhost:5173';
						return res.redirect(`${frontendUrl}?login=error&reason=missing_role`);
					}
				}
			}

			// 4. Retourner les infos utilisateur
			if (forType === 'launcher') {
				// Launcher - Implicit flow
				const frontendUrl = process.env.FRONTEND_URL || req.query.redirect_uri || 'http://localhost:5173';
				res.redirect(`${frontendUrl}/auth/callback#access_token=${access_token}&token_type=Bearer&expires_in=604800`);
			} else {
				// Boutique - Authorization code flow
				// Rediriger vers le backend callback avec token et user_id
				// Le backend créera la session et redirigera vers le frontend
				const backendCallbackUrl = frontendRedirect || process.env.BOUTIQUE_BACKEND_URL || 'http://localhost:3010';

				// backendCallbackUrl contient déjà le chemin complet, on ne doit pas ajouter /api/auth/discord/callback
				// Rediriger vers le backend callback
				res.redirect(`${backendCallbackUrl}?token=${access_token}&user_id=${userId}`);
			}

		} catch (err) {
			console.error('[OAuth] Callback Error', err.response?.data || err.message);
			const frontendUrl = process.env.FRONTEND_URL || req.query.redirect_uri || 'http://localhost:5173';
			res.redirect(`${frontendUrl}?login=error&reason=${encodeURIComponent(err.message || 'oauth_error')}`);
		}
	});

	console.log('[OAuth] OAuth routes configured');
}

module.exports = { setupOAuthRoutes };

