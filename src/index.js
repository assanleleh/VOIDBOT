require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, PermissionFlagsBits, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActivityType } = require('discord.js');
const http = require('http');
const crypto = require('crypto');
const querystring = require('querystring');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const util = require('util');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const DATA_DIR = path.join(__dirname, 'data');
const WL_STORE_PATH = path.join(DATA_DIR, 'wl-log.json');

const CONFIG_DEV_PATH = path.join(__dirname, 'config.development.json');
const CONFIG_PROD_PATH = path.join(__dirname, 'config.production.json');
const CONFIG_DEFAULT_PATH = path.join(__dirname, 'config.json');

/**
 * Load configuration based on NODE_ENV.
 * - production: uses config.production.json
 * - development (default): uses config.development.json
 * Fallback to config.json if specific env config is missing.
 */
function loadConfig() {
	const env = process.env.NODE_ENV || 'development';
	console.log(`[config] Loading configuration for environment: ${env}`);

	let targetPath = env === 'production' ? CONFIG_PROD_PATH : CONFIG_DEV_PATH;

	if (fs.existsSync(targetPath)) {
		console.log(`[config] Loaded ${path.basename(targetPath)}`);
		return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
	}

	// Fallback logic
	if (fs.existsSync(CONFIG_DEFAULT_PATH)) {
		console.warn(`[config] ${path.basename(targetPath)} not found. Falling back to config.json`);
		return JSON.parse(fs.readFileSync(CONFIG_DEFAULT_PATH, 'utf8'));
	}

	throw new Error(`Configuration file not found. Please create ${path.basename(targetPath)} or src/config.json`);
}

const config = loadConfig();

function assertEnv(name) {
	const value = process.env[name];
	if (!value || value.trim().length === 0) {
		throw new Error(`Variable d'environnement manquante: ${name}`);
	}
	return value;
}

const token = assertEnv('DISCORD_TOKEN');

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildEmojisAndStickers
	],
	partials: [Partials.Channel]
});

// Génère (si possible) un lien d'invitation permanent pour un serveur donné
async function ensurePermanentInviteLinkForGuild(guildId) {
	try {
		const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
		if (!guild) return null;
		// Choisir un salon textuel où le bot peut créer une invitation
		let channel = null;
		if (guild.systemChannelId) channel = guild.channels.cache.get(guild.systemChannelId) || await guild.channels.fetch(guild.systemChannelId).catch(() => null);
		if (!channel || channel.type !== ChannelType.GuildText) {
			channel = guild.channels.cache.find((c) => c.type === ChannelType.GuildText);
			if (!channel) {
				const fetched = await guild.channels.fetch().catch(() => null);
				channel = fetched?.find?.((c) => c.type === ChannelType.GuildText) || null;
			}
		}
		if (!channel || channel.type !== ChannelType.GuildText) return null;
		// Créer une invitation sans expiration ni limite d'utilisations
		try {
			const invite = await (channel.createInvite ? channel.createInvite({ maxAge: 0, maxUses: 0, temporary: false, unique: true, reason: 'Lien village auto (permanent)' }) : channel.invites.create({ maxAge: 0, maxUses: 0, temporary: false, unique: true, reason: 'Lien village auto (permanent)' }));
			return invite?.url || (invite?.code ? `https://discord.gg/${invite.code}` : null);
		} catch (_) {
			return null;
		}
	} catch (_) {
		return null;
	}
}

// === Logging centralisé vers un salon dédié ===
const originalConsole = {
	log: console.log.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console)
};

let logChannel = null;
let pendingLogs = [];

function formatArgsToString(args) {
	try {
		return args
			.map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 2, colors: false })))
			.join(' ');
	} catch (_) {
		return String(args);
	}
}

async function resolveLogChannel() {
	const targetId = config.generalLogChannelId || config.logChannelId;
	if (!targetId) return null;
	try {
		const channel = client.channels.cache.get(targetId) || await client.channels.fetch(targetId);
		return (channel && channel.isTextBased && channel.type === ChannelType.GuildText) ? channel : null;
	} catch (_) {
		return null;
	}
}

async function sendLog(level, content) {
	const timestamp = new Date().toISOString();
	const header = `[${level.toUpperCase()}] ${timestamp}`;
	const message = `${header}\n${content}`;
	// En attente tant que le salon n'est pas prêt
	if (!logChannel) {
		pendingLogs.push({ level, content: message });
		return;
	}
	await sendInChunks(logChannel, message);
}

async function sendInChunks(channel, message) {
	const maxLen = 1900; // garder une marge pour les backticks éventuels
	if (message.length <= maxLen) {
		await channel.send({ content: message });
		return;
	}
	for (let i = 0; i < message.length; i += maxLen) {
		const part = message.slice(i, i + maxLen);
		await channel.send({ content: part });
	}
}

const logInfo = (msg) => { sendLog('info', msg).catch(() => { }); };
// === WL store helpers ===
function ensureDataDir() {
	try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) { }
}
function loadWlStore() {
	try {
		if (fs.existsSync(WL_STORE_PATH)) {
			const raw = fs.readFileSync(WL_STORE_PATH, 'utf8');
			return JSON.parse(raw);
		}
	} catch (_) { }
	return { submissions: [] };
}
function saveWlStore(store) {
	try { fs.writeFileSync(WL_STORE_PATH, JSON.stringify(store, null, 2), 'utf8'); } catch (_) { }
}
function upsertSubmission(entry) {
	ensureDataDir();
	const store = loadWlStore();
	const idx = store.submissions.findIndex((e) => e.userId === entry.userId && e.messageId === entry.messageId);
	if (idx >= 0) store.submissions[idx] = { ...store.submissions[idx], ...entry };
	else store.submissions.push(entry);
	saveWlStore(store);
}
function markDecision(userId, messageId, status, reviewerId, stage) {
	ensureDataDir();
	const store = loadWlStore();
	const idx = store.submissions.findIndex((e) => e.userId === userId && e.messageId === messageId);
	const now = new Date().toISOString();
	if (idx >= 0) {
		store.submissions[idx].status = status;
		store.submissions[idx].decidedAt = now;
		store.submissions[idx].reviewerId = reviewerId;
		if (stage) store.submissions[idx].stage = stage; // 'form' ou 'vocal'
	} else {
		store.submissions.push({ userId, messageId, status, decidedAt: now, reviewerId, stage });
	}
	saveWlStore(store);
}
function markGrantFinal(userId, reviewerId) {
	ensureDataDir();
	const store = loadWlStore();
	const latestIdx = (() => {
		let idx = -1; let latest = 0;
		store.submissions.forEach((s, i) => {
			if (s.userId === userId) {
				const t = Date.parse(s.submittedAt || s.decidedAt || 0);
				if (t > latest) { latest = t; idx = i; }
			}
		});
		return idx;
	})();
	const now = new Date().toISOString();
	if (latestIdx >= 0) {
		store.submissions[latestIdx].status = 'accepted_final';
		store.submissions[latestIdx].grantedAt = now;
		store.submissions[latestIdx].grantedBy = reviewerId;
		store.submissions[latestIdx].stage = 'vocal';
	} else {
		store.submissions.push({ userId, status: 'accepted_final', grantedAt: now, grantedBy: reviewerId, stage: 'vocal' });
	}
	saveWlStore(store);
}
function summarizeDailyByVillage(dateIso) {
	const store = loadWlStore();
	const day = dateIso ? new Date(dateIso) : new Date();
	const yyyy = day.getUTCFullYear();
	const mm = String(day.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(day.getUTCDate()).padStart(2, '0');
	const dayPrefix = `${yyyy}-${mm}-${dd}`; // UTC
	const today = store.submissions.filter((s) => (s.submittedAt || '').startsWith(dayPrefix));
	const treated = today.filter((s) => s.status === 'accepted' || s.status === 'rejected').length;
	const pending = today.filter((s) => !s.status).length;
	const byVillage = { Konoha: 0, Suna: 0, Autre: 0 };
	today.forEach((s) => {
		const v = s.faction;
		if (v === 'Konoha') byVillage.Konoha++;
		else if (v === 'Suna') byVillage.Suna++;
		else byVillage.Autre++;
	});
	return { treated, pending, total: today.length, byVillage };
}
function summarizeWeeklyByReviewer(startIso) {
	const store = loadWlStore();
	const start = startIso ? new Date(startIso) : new Date();
	// get Monday 00:00 UTC of current week
	const now = new Date();
	const day = now.getUTCDay();
	const diff = (day === 0 ? 6 : day - 1); // 0=Sun -> 6
	const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff, 0, 0, 0));
	const entries = store.submissions.filter((s) => s.decidedAt && new Date(s.decidedAt) >= monday);
	const perReviewer = {};
	for (const s of entries) {
		const rid = s.reviewerId || 'unknown';
		perReviewer[rid] = (perReviewer[rid] || 0) + 1;
	}
	return perReviewer;
}

function countReviewerAcceptedToday(reviewerId) {
	const store = loadWlStore();
	const now = new Date();
	const yyyy = now.getUTCFullYear();
	const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(now.getUTCDate()).padStart(2, '0');
	const prefix = `${yyyy}-${mm}-${dd}`;
	return store.submissions.filter((s) => s.status === 'accepted' && s.reviewerId === reviewerId && (s.decidedAt || '').startsWith(prefix)).length;
}
function countReviewerAcceptedTodayByStage(reviewerId, stage) {
	const store = loadWlStore();
	const now = new Date();
	const yyyy = now.getUTCFullYear();
	const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(now.getUTCDate()).padStart(2, '0');
	const prefix = `${yyyy}-${mm}-${dd}`;
	return store.submissions.filter((s) => s.reviewerId === reviewerId && s.stage === stage && (s.decidedAt || s.grantedAt || '').startsWith(prefix)).length;
}

// Redirection console.log uniquement -> salon de logs (et stdout d'origine)
console.log = (...args) => {
	originalConsole.log(...args);
	logInfo(formatArgsToString(args));
};

// Mémoire éphémère: faction choisie par utilisateur avant soumission du formulaire
const pendingFactionByUser = new Map();
const activeOrals = new Map(); // key: messageId -> { targetUserId, responses: Map<qIdx, boolean>, reviewerId, page: number }
const ORAL_PAGE_SIZE = 4;

function getOralQuestions() {
	const qs = Array.isArray(config.oralQuestions) ? config.oralQuestions.slice(0, 15) : [];
	return qs;
}

function buildOralEmbed(state, targetTag) {
	const qs = getOralQuestions();
	const lines = qs.map((q, i) => {
		const v = state.responses.get(i);
		const mark = v === true ? '✅' : v === false ? '❌' : '▫️';
		return `${String(i + 1).padStart(2, '0')}. ${mark} ${q}`;
	});
	return new EmbedBuilder()
		.setTitle(`Entretien Oral • ${targetTag}`)
		.setDescription(lines.join('\n') || 'Aucune question')
		.setColor(0x5865F2)
		.setTimestamp(new Date());
}

function buildOralRows(state) {
	const qs = getOralQuestions();
	const start = (state.page || 0) * ORAL_PAGE_SIZE;
	const end = Math.min(start + ORAL_PAGE_SIZE, qs.length);
	const rows = [];
	for (let i = start; i < end; i++) {
		const current = state.responses.get(i);
		const select = new StringSelectMenuBuilder()
			.setCustomId(`oral_sel_${i}`)
			.setPlaceholder(`${i + 1}. ${qs[i]}`)
			.addOptions(
				{ label: 'Validé', value: 'yes', emoji: '✅', default: current === true },
				{ label: 'Refusé', value: 'no', emoji: '❌', default: current === false }
			);
		rows.push(new ActionRowBuilder().addComponents(select));
	}
	// Rangée de navigation dédiée
	const maxPage = Math.max(0, Math.ceil(qs.length / ORAL_PAGE_SIZE) - 1);
	rows.push(new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId('oral_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled((state.page || 0) <= 0),
		new ButtonBuilder().setCustomId('oral_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled((state.page || 0) >= maxPage),
		new ButtonBuilder().setCustomId('oral_submit').setLabel('Terminer').setStyle(ButtonStyle.Primary)
	));
	return rows;
}

function buildOralPayload(state) {
	const memberTag = `<@${state.targetUserId}>`;
	const embed = buildOralEmbed(state, memberTag);
	const rows = buildOralRows(state);
	return { embeds: [embed], components: rows };
}

async function renderOralMessage(message, state) {
	const payload = buildOralPayload(state);
	await message.edit(payload);
}

function resolveEmoji(guild, configValue, fallbackName, fallbackUnicode) {
	const parsed = parseEmojiConfig(configValue);
	if (parsed) return parsed;
	try {
		if (guild) {
			const found = guild.emojis.cache.find((e) => e.name === fallbackName);
			if (found) {
				return { id: found.id, name: found.name, animated: found.animated };
			}
		}
	} catch (_) { }
	return fallbackUnicode;
}

function parseEmojiConfig(value) {
	if (!value) return undefined;
	// Supporte les émojis personnalisés Discord: <:name:id> ou <a:name:id>
	const match = typeof value === 'string' && value.match(/^<(a?):([A-Za-z0-9_]{2,}):(\d+)>$/);
	if (match) {
		return { id: match[3], name: match[2], animated: match[1] === 'a' };
	}
	// Si ce n'est pas un format personnalisé, ne pas court-circuiter la recherche guild → renvoyer undefined
	return undefined;
}

// === Gestion du statut du bot ===
async function updateBotStatus() {
	try {
		const guildId = config.statusGuildId;
		if (!guildId) return;

		const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
		if (!guild) return;

		const count = guild.memberCount;
		const template = config.statusText || 'Surveille {count} membres';
		const statusText = template.replace('{count}', count);

		let type = ActivityType.Watching;
		if (config.statusType) {
			const t = String(config.statusType).toLowerCase();
			if (t === 'playing') type = ActivityType.Playing;
			else if (t === 'listening') type = ActivityType.Listening;
			else if (t === 'competing') type = ActivityType.Competing;
			else if (t === 'streaming') type = ActivityType.Streaming;
		}

		client.user.setPresence({
			activities: [{ name: statusText, type: type }],
			status: 'online'
		});
		// logInfo(`[STATUS] Mis à jour: ${statusText} (${guild.name})`); // Verbose, à décommenter si besoin
	} catch (e) {
		originalConsole.error('Erreur mise à jour statut bot:', e);
	}
}

client.once('ready', async () => {
	logChannel = await resolveLogChannel();
	originalConsole.log(`[ready] Connecté en tant que ${client.user.tag}`);
	if (logChannel) {
		await logInfo(`[ready] Bot en ligne: ${client.user.tag}`);
		if (pendingLogs.length > 0) {
			const toFlush = pendingLogs;
			pendingLogs = [];
			for (const entry of toFlush) {
				await sendInChunks(logChannel, entry.content).catch(() => { });
			}
		}
	}

	// Initialiser et planifier le statut
	updateBotStatus();
	setInterval(updateBotStatus, 10 * 60 * 1000); // maj toutes les 10 min

	// Publier/assurer le panneau dans #devenir-wl
	try {
		const targetGuildId = config.whitelistApplyGuildId;
		// Validate snowflake to avoid crash if config has placeholder
		const isValidSnowflake = (id) => /^\d{17,20}$/.test(id);
		const targetGuild = (targetGuildId && isValidSnowflake(targetGuildId))
			? client.guilds.cache.get(targetGuildId) || await client.guilds.fetch(targetGuildId).catch(() => null)
			: null;
		if (targetGuild) {
			const channel = targetGuild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === String(config.whitelistApplyChannelName || 'devenir-wl'));
			if (channel) {
				// Ne pas republier si un message récent du bot contenant le bouton existe déjà
				try {
					const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
					const exists = messages && messages.find((m) => m.author?.id === client.user.id && m.components?.some(r => r.components?.some(b => b.customId === 'whitelist_apply')));
					if (!exists) {
						const text = config.whitelistApplyPanelText || 'Pour devenir whitelist cliquer sur le bouton';
						const title = config.whitelistApplyTitle || 'Devenir whitelist';
						const color = Number(config.whitelistApplyColor || 0x57F287);
						const embed = new EmbedBuilder().setTitle(title).setDescription(text).setColor(color);
						const bannerPath = config.whitelistApplyBannerPath ? path.resolve(process.cwd(), config.whitelistApplyBannerPath) : null;
						const files = [];
						if (bannerPath && fs.existsSync(bannerPath)) {
							files.push({ attachment: bannerPath, name: path.basename(bannerPath) });
							embed.setImage(`attachment://${path.basename(bannerPath)}`);
						}
						await channel.send({ embeds: [embed], components: [buildWhitelistApplyRow()], files });
						logInfo(`[APPLY] panneau publié dans #${channel.name} (${channel.id})`);
					}
				} catch (e) {
					originalConsole.error('Erreur vérification panneau WL:', e);
				}
			}
		}
	} catch (e) {
		originalConsole.error('Erreur publication panneau whitelist:', e);
	}

	// Publier/assurer le panneau de suivi dans le serveur/canal configurés
	try {
		const guildId = config.suiviGuildId;
		const channelId = config.suiviChannelId;
		if (guildId && channelId && Array.isArray(config.suiviThemes) && config.suiviThemes.length > 0) {
			const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
			if (guild) {
				const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
				if (channel && channel.isTextBased && channel.type === ChannelType.GuildText) {
					try {
						const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
						const exists = messages && messages.find((m) => m.author?.id === client.user.id && m.components?.some((row) => row.components?.some((c) => c.customId === 'suivi_select')));
						if (exists) {
							// Éditer pour refléter les changements (ex: ajout des émojis)
							const embed = new EmbedBuilder()
								.setTitle(config.suiviPanelTitle || 'Ouvrir un ticket de suivi')
								.setDescription(config.suiviPanelDescription || 'Choisissez une catégorie pour ouvrir un ticket de suivi privé.')
								.setColor(Number(config.suiviPanelColor || 0x5865F2));
							const files = [];
							const bannerLocal = config.suiviBannerPath ? path.resolve(process.cwd(), config.suiviBannerPath) : null;
							if (bannerLocal && fs.existsSync(bannerLocal)) {
								files.push({ attachment: bannerLocal, name: path.basename(bannerLocal) });
								embed.setImage(`attachment://${path.basename(bannerLocal)}`);
							} else if (config.suiviBannerUrl) {
								embed.setImage(config.suiviBannerUrl);
							}
							await exists.edit({ embeds: [embed], components: [buildSuiviSelectMenu()], files }).catch(() => { });
							logInfo(`[SUIVI] panneau mis à jour dans #${channel.name} (${channel.id})`);
						} else {
							const embed = new EmbedBuilder()
								.setTitle(config.suiviPanelTitle || 'Ouvrir un ticket de suivi')
								.setDescription(config.suiviPanelDescription || 'Choisissez une catégorie pour ouvrir un ticket de suivi privé.')
								.setColor(Number(config.suiviPanelColor || 0x5865F2));
							const files = [];
							const bannerLocal = config.suiviBannerPath ? path.resolve(process.cwd(), config.suiviBannerPath) : null;
							if (bannerLocal && fs.existsSync(bannerLocal)) {
								files.push({ attachment: bannerLocal, name: path.basename(bannerLocal) });
								embed.setImage(`attachment://${path.basename(bannerLocal)}`);
							} else if (config.suiviBannerUrl) {
								embed.setImage(config.suiviBannerUrl);
							}
							await channel.send({ embeds: [embed], components: [buildSuiviSelectMenu()], files });
							logInfo(`[SUIVI] panneau publié dans #${channel.name} (${channel.id})`);
						}
					} catch (e) {
						originalConsole.error('Erreur vérification panneau suivi:', e);
					}
				}
			}
		}
	} catch (e) {
		originalConsole.error('Erreur publication panneau suivi:', e);
	}

	// Publier/assurer le panneau de suivi actif
	try {
		const guildId = config.suiviActifGuildId || config.suiviGuildId;
		const channelId = config.suiviActifChannelId;
		if (guildId && channelId && Array.isArray(config.suiviActifThemes) && config.suiviActifThemes.length > 0) {
			const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
			if (guild) {
				const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
				if (channel && channel.isTextBased && channel.type === ChannelType.GuildText) {
					try {
						const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
						const exists = messages && messages.find((m) => m.author?.id === client.user.id && m.components?.some((row) => row.components?.some((c) => c.customId === 'suivi_actif_select')));
						const embed = new EmbedBuilder()
							.setTitle(config.suiviActifPanelTitle || 'Ouvrir un ticket de suivi actif')
							.setDescription(config.suiviActifPanelDescription || 'Choisissez une catégorie pour ouvrir un ticket de suivi actif.')
							.setColor(Number(config.suiviActifPanelColor || 0x5865F2));
						const files = [];
						const bannerLocal = config.suiviActifBannerPath ? path.resolve(process.cwd(), config.suiviActifBannerPath) : null;
						if (bannerLocal && fs.existsSync(bannerLocal)) {
							files.push({ attachment: bannerLocal, name: path.basename(bannerLocal) });
							embed.setImage(`attachment://${path.basename(bannerLocal)}`);
						} else if (config.suiviActifBannerUrl) {
							embed.setImage(config.suiviActifBannerUrl);
						}
						if (exists) {
							await exists.edit({ embeds: [embed], components: [buildSuiviActifSelectMenu()], files }).catch(() => { });
							logInfo(`[SUIVI_ACTIF] panneau mis à jour dans #${channel.name} (${channel.id})`);
						} else {
							await channel.send({ embeds: [embed], components: [buildSuiviActifSelectMenu()], files });
							logInfo(`[SUIVI_ACTIF] panneau publié dans #${channel.name} (${channel.id})`);
						}
					} catch (e) {
						originalConsole.error('Erreur vérification panneau suivi actif:', e);
					}
				}
			}
		}
	} catch (e) {
		originalConsole.error('Erreur publication panneau suivi actif:', e);
	}

	// Publier un message explicatif dans le salon "demande de rôle"
	try {
		const channelId = config.roleRequestChannelId;
		if (channelId) {
			const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
			if (channel && channel.isTextBased && channel.type === ChannelType.GuildText) {
				const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
				const existing = messages && messages.find((m) => m.author?.id === client.user.id && m.embeds?.[0]?.title === 'Demande de rôle');
				const embed = new EmbedBuilder()
					.setTitle('Demande de rôle')
					.setColor(0x5865F2)
					.setDescription(
						config.roleRequestMessage ||
						"Ce salon est dédié aux demandes de rôle. Ne faites une demande que si vous êtes staff ou membre d'un clan. Indiquez votre pseudo, le rôle à attribuer et une preuve (capture ou lien). Toute demande hors cadre sera refusée."
					);
				if (existing) {
					await existing.edit({ embeds: [embed], components: [] }).catch(() => { });
					logInfo(`[ROLE_REQ] message mis à jour dans #${channel.name} (${channel.id})`);
				} else {
					await channel.send({ embeds: [embed] });
					logInfo(`[ROLE_REQ] message publié dans #${channel.name} (${channel.id})`);
				}
			}
		}
	} catch (e) {
		originalConsole.error('Erreur publication message demande de rôle:', e);
	}

	// Publier un embed d'informations avec lien SUIVI RP
	try {
		const infoChannelId = config.infoChannelId;
		const infoLink = config.infoSuiviLink;
		if (infoChannelId && infoLink) {
			const channel = client.channels.cache.get(infoChannelId) || await client.channels.fetch(infoChannelId).catch(() => null);
			if (channel && channel.isTextBased && channel.type === ChannelType.GuildText) {
				const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
				const existing = messages && messages.find((m) => m.author?.id === client.user.id && m.embeds?.[0]?.title === 'Informations • SUIVI RP');
				const embed = new EmbedBuilder()
					.setTitle('Informations • SUIVI RP')
					.setDescription(`[SUIVI RP](${infoLink}) — Slots techniques disponibles.`)
					.setColor(0x5865F2);
				const files = [];
				const bannerLocal = config.infoBannerPath ? path.resolve(process.cwd(), config.infoBannerPath) : null;
				if (bannerLocal && fs.existsSync(bannerLocal)) {
					files.push({ attachment: bannerLocal, name: path.basename(bannerLocal) });
					embed.setImage(`attachment://${path.basename(bannerLocal)}`);
				}
				if (existing) {
					await existing.edit({ embeds: [embed], files }).catch(() => { });
					logInfo(`[INFO] embed SUIVI RP mis à jour dans #${channel.name} (${channel.id})`);
				} else {
					await channel.send({ embeds: [embed], files });
					logInfo(`[INFO] embed SUIVI RP publié dans #${channel.name} (${channel.id})`);
				}
			}
		}
	} catch (e) {
		originalConsole.error('Erreur publication embed informations:', e);
	}

	// Publier/assurer le widget Carte Shinobi (douanes)
	try {
		const guildId = config.whitelistApplyGuildId; // serveur douanes
		const channelId = config.douaneCarteChannelId;
		if (guildId && channelId && Array.isArray(config.douaneCarteThemes) && config.douaneCarteThemes.length > 0) {
			const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
			if (guild) {
				const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
				if (channel && channel.isTextBased && channel.type === ChannelType.GuildText) {
					const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
					const existing = messages && messages.find((m) => m.author?.id === client.user.id && m.components?.some((row) => row.components?.some((c) => c.customId === 'douane_carte_select')));
					const embed = new EmbedBuilder()
						.setTitle('Carte Shinobi • Demandes')
						.setDescription('Choisissez une demande pour ouvrir un ticket privé avec la douane.')
						.setColor(0x5865F2);
					const files = [];
					const bannerLocal = config.douaneCarteBannerPath ? path.resolve(process.cwd(), config.douaneCarteBannerPath) : null;
					if (bannerLocal && fs.existsSync(bannerLocal)) {
						files.push({ attachment: bannerLocal, name: path.basename(bannerLocal) });
						embed.setImage(`attachment://${path.basename(bannerLocal)}`);
					}
					if (existing) {
						await existing.edit({ embeds: [embed], components: [buildDouaneCarteSelectMenu()], files }).catch(() => { });
						logInfo(`[DOUANE] Carte Shinobi mis à jour dans #${channel.name} (${channel.id})`);
					} else {
						await channel.send({ embeds: [embed], components: [buildDouaneCarteSelectMenu()], files });
						logInfo(`[DOUANE] Carte Shinobi publié dans #${channel.name} (${channel.id})`);
					}
				}
			}
		}
	} catch (e) {
		originalConsole.error('Erreur publication widget Carte Shinobi:', e);
	}

	// Publier/assurer deux widgets (Konoha/Suna) et les épingler pour persistance
	try {
		const mainInfoChannelId = config.mainInfoChannelId;
		if (mainInfoChannelId) {
			const channel = client.channels.cache.get(mainInfoChannelId) || await client.channels.fetch(mainInfoChannelId).catch(() => null);
			if (channel && channel.isTextBased && channel.type === ChannelType.GuildText) {
				const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
				const existingKonoha = messages?.find((m) => m.author?.id === client.user.id && m.embeds?.[0]?.title === 'Discord Village • Konoha');
				const existingSuna = messages?.find((m) => m.author?.id === client.user.id && m.embeds?.[0]?.title === 'Discord Village • Suna');

				// Konoha widget (éditer si existe, sinon créer) + épingler
				const konohaEmbed = new EmbedBuilder()
					.setTitle('Discord Village • Konoha')
					.setColor(0x2ecc71);
				let konohaLink = (config.konohaInviteLink && String(config.konohaInviteLink).trim().length > 0) ? config.konohaInviteLink : null;
				if (!konohaLink && config.konohaGuildId) {
					konohaLink = await ensurePermanentInviteLinkForGuild(config.konohaGuildId).catch(() => null);
				}
				konohaEmbed.setDescription(konohaLink ? `[Rejoindre Konoha](${konohaLink})` : 'Lien d\'invitation indisponible. Contactez un staff.');
				const kFiles = [];
				const kBanner = config.konohaBannerPath ? path.resolve(process.cwd(), config.konohaBannerPath) : null;
				if (kBanner && fs.existsSync(kBanner)) { kFiles.push({ attachment: kBanner, name: path.basename(kBanner) }); konohaEmbed.setImage(`attachment://${path.basename(kBanner)}`); }
				let konohaMsg = existingKonoha;
				if (konohaMsg) {
					await konohaMsg.edit({ embeds: [konohaEmbed], files: kFiles }).catch(() => { });
				} else {
					konohaMsg = await channel.send({ embeds: [konohaEmbed], files: kFiles }).catch(() => null);
				}
				if (konohaMsg && !konohaMsg.pinned) { await konohaMsg.pin().catch(() => { }); }

				// Suna widget (éditer si existe, sinon créer) + épingler
				const sunaEmbed = new EmbedBuilder()
					.setTitle('Discord Village • Suna')
					.setColor(0xf1c40f);
				let sunaLink = (config.sunaInviteLink && String(config.sunaInviteLink).trim().length > 0) ? config.sunaInviteLink : null;
				if (!sunaLink && config.sunaGuildId) {
					sunaLink = await ensurePermanentInviteLinkForGuild(config.sunaGuildId).catch(() => null);
				}
				sunaEmbed.setDescription(sunaLink ? `[Rejoindre Suna](${sunaLink})` : 'Lien d\'invitation indisponible. Contactez un staff.');
				const sFiles = [];
				const sBanner = config.sunaBannerPath ? path.resolve(process.cwd(), config.sunaBannerPath) : null;
				if (sBanner && fs.existsSync(sBanner)) { sFiles.push({ attachment: sBanner, name: path.basename(sBanner) }); sunaEmbed.setImage(`attachment://${path.basename(sBanner)}`); }
				let sunaMsg = existingSuna;
				if (sunaMsg) {
					await sunaMsg.edit({ embeds: [sunaEmbed], files: sFiles }).catch(() => { });
				} else {
					sunaMsg = await channel.send({ embeds: [sunaEmbed], files: sFiles }).catch(() => null);
				}
				if (sunaMsg && !sunaMsg.pinned) { await sunaMsg.pin().catch(() => { }); }

				logInfo(`[VILLAGES] widgets Konoha/Suna assurés et épinglés dans #${channel.name} (${channel.id})`);
			}
		}
	} catch (e) {
		originalConsole.error('Erreur publication widgets villages:', e);
	}

	// Démarrer le serveur webhook GitHub si configuré
	try {
		if (config.githubWebhookPort && config.githubCommitChannelName) {
			const port = Number(config.githubWebhookPort);
			const server = http.createServer(async (req, res) => {
				if (req.method !== 'POST' || req.url !== '/github') {
					res.statusCode = 404; res.end('Not found'); return;
				}
				let body = '';
				req.on('data', (chunk) => { body += chunk; });
				await new Promise((resolve) => req.on('end', resolve));
				// Vérifier signature si secret fourni
				const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET || config.githubWebhookSecret;
				if (webhookSecret) {
					const signature = req.headers['x-hub-signature-256'];
					const hmac = crypto.createHmac('sha256', webhookSecret);
					hmac.update(body, 'utf8');
					const digest = 'sha256=' + hmac.digest('hex');
					if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
						res.statusCode = 401; res.end('Invalid signature'); return;
					}
				}
				try {
					const event = req.headers['x-github-event'];
					const contentType = String(req.headers['content-type'] || '').toLowerCase();
					let payload;
					if (contentType.includes('application/x-www-form-urlencoded')) {
						const parsed = querystring.parse(body);
						payload = JSON.parse(parsed.payload);
					} else {
						payload = JSON.parse(body);
					}
					if (event === 'push') {
						logInfo('[GITHUB] webhook push reçu');
						const guild = client.guilds.cache.get(config.whitelistApplyGuildId) || await client.guilds.fetch(config.whitelistApplyGuildId);
						let channel = null;
						if (config.githubCommitChannelId) {
							channel = guild.channels.cache.get(config.githubCommitChannelId) || await guild.channels.fetch(config.githubCommitChannelId).catch(() => null);
						}
						if (!channel) {
							channel = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name.toLowerCase() === String(config.githubCommitChannelName).toLowerCase());
						}
						if (channel) {
							const repo = payload.repository?.full_name || 'repo';
							const branch = payload.ref?.split('/').pop();
							const commits = (payload.commits || []).slice(-5);
							const compareUrl = payload.compare || payload.repository?.html_url;
							const titleCount = commits.length || 0;
							const title = `[${repo}:${branch}] ${titleCount} new commit${titleCount === 1 ? '' : 's'}`;
							const lines = commits.map((c) => {
								const short = c.id ? c.id.substring(0, 7) : 'commit';
								const msg = (c.message || '').split('\n')[0];
								const link = c.url || compareUrl;
								const author = c.author?.name || payload.pusher?.name || 'unknown';
								return `[` + short + `](` + link + `) ` + msg + ` — ` + author;
							});
							const embed = new EmbedBuilder()
								.setTitle(title)
								.setURL(compareUrl)
								.setColor(0x2f3136)
								.setDescription(lines.join('\n') || 'Aucun commit')
								.setTimestamp(new Date(payload.head_commit?.timestamp || Date.now()));
							const senderName = payload.sender?.login || payload.pusher?.name;
							const senderAvatar = payload.sender?.avatar_url;
							if (senderName) embed.setAuthor({ name: senderName, iconURL: senderAvatar || undefined });
							await channel.send({ embeds: [embed] });
							logInfo(`[GITHUB] push ${repo}@${branch} (${titleCount} commits) → #${channel.name}`);
						} else {
							logInfo('[GITHUB] Salon commit introuvable (id/name).');
						}
					}
					res.statusCode = 200; res.end('OK');
				} catch (e) {
					originalConsole.error('Erreur webhook GitHub:', e);
					res.statusCode = 500; res.end('Error');
				}
			});
			server.listen(port, () => originalConsole.log(`[webhook] GitHub en écoute sur http://localhost:${port}/github`));
		}
	} catch (e) {
		originalConsole.error('Erreur démarrage webhook GitHub:', e);
	}



});

// === API Whitelist Check & Role Verification ===
const app = express();
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
	console.log(`[API] ${req.method} ${req.url}`);
	next();
});

app.post('/api/whitelist/check', async (req, res) => {
	const { token } = req.body;
	if (!token) return res.status(400).json({ auth: false, reason: 'Token missing' });

	try {
		// Verify Token & Get User ID
		const userResp = await axios.get('https://discord.com/api/users/@me', {
			headers: { Authorization: `Bearer ${token}` }
		});
		const userId = userResp.data.id;

		const guildId = config.whitelistApplyGuildId; // Using the main guild ID from config
		const roleId = config.whitelistRoleId;

		const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
		if (!guild) return res.status(500).json({ auth: false, reason: 'Guild error' });

		const member = await guild.members.fetch(userId).catch(() => null);
		if (!member) return res.status(403).json({ auth: false, reason: 'Not in guild' });

		// Check Role
		const hasRole = member.roles.cache.has(roleId);
		// Check if user is the bot itself (just in case)
		const isBot = userId === client.user.id;

		if (hasRole || isBot) {
			return res.json({ auth: true, user: userResp.data });
		} else {
			return res.status(403).json({ auth: false, reason: 'Missing Role' });
		}
	} catch (err) {
		console.error('[API] Whitelist Check Error', err.response?.data || err.message);
		return res.status(401).json({ auth: false, reason: 'Invalid Token or API Error' });
	}
});

app.post('/api/check-role', async (req, res) => {
	const { userId, role } = req.body;
	if (!userId || !role) return res.status(400).json({ error: 'Missing userId or role' });

	try {
		let targetRoleId;
		if (role === 'alpha') {
			targetRoleId = config.alphaRoleId;
		} else if (role === 'beta') {
			targetRoleId = config.betaRoleId;
		} else {
			return res.status(400).json({ error: 'Unknown role type' });
		}

		if (!targetRoleId) {
			return res.status(500).json({ error: 'Role not configured' });
		}

		const guildId = config.whitelistApplyGuildId; // Using main guild
		const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
		if (!guild) return res.status(500).json({ error: 'Guild not found' });

		const member = await guild.members.fetch(userId).catch(() => null);
		if (!member) return res.json({ hasRole: false, reason: 'Member not found' });

		const hasRole = member.roles.cache.has(targetRoleId);
		return res.json({ hasRole });

	} catch (err) {
		console.error('[API] Check Role Error', err);
		return res.status(500).json({ error: 'Internal Server Error' });
	}
});

// Start API Server
const apiPort = config.apiPort || 3001;
app.get('/', (req, res) => res.send('VOIDBOT API Online'));

app.listen(apiPort, () => {
	console.log(`[API] Whitelist Server running on port ${apiPort}`);
});


/**
 * Build the select menu for ticket themes based on configuration
 */
function buildThemeSelectMenu() {
	const options = (config.themes || []).map((theme) => ({
		label: theme.label,
		value: theme.key,
		description: theme.description || undefined,
		emoji: theme.emoji || undefined
	}));

	const select = new StringSelectMenuBuilder()
		.setCustomId('ticket_theme_select')
		.setPlaceholder('Choisissez un thème de ticket')
		.addOptions(options);

	return new ActionRowBuilder().addComponents(select);
}

function buildCloseButtonRow() {
	const closeBtn = new ButtonBuilder()
		.setCustomId('ticket_close')
		.setLabel('Fermer le ticket')
		.setStyle(ButtonStyle.Danger);
	return new ActionRowBuilder().addComponents(closeBtn);
}

function buildWhitelistApplyRow() {
	const applyBtn = new ButtonBuilder()
		.setCustomId('whitelist_apply')
		.setLabel('Devenir whitelist')
		.setStyle(ButtonStyle.Success);
	return new ActionRowBuilder().addComponents(applyBtn);
}

/**
 * Build the select menu for suivi categories based on configuration
 */
function buildSuiviSelectMenu() {
	const options = (config.suiviThemes || []).map((theme) => ({
		label: theme.label,
		value: theme.key,
		description: theme.description || undefined,
		emoji: theme.emoji || undefined
	}));

	const select = new StringSelectMenuBuilder()
		.setCustomId('suivi_select')
		.setPlaceholder('Choisissez une catégorie de suivi')
		.addOptions(options);

	return new ActionRowBuilder().addComponents(select);
}

/**
 * Build the select menu for suivi actif categories based on configuration
 */
function buildSuiviActifSelectMenu() {
	const options = (config.suiviActifThemes || []).map((theme) => ({
		label: theme.label,
		value: theme.key,
		description: theme.description || undefined,
		emoji: theme.emoji || undefined
	}));

	const select = new StringSelectMenuBuilder()
		.setCustomId('suivi_actif_select')
		.setPlaceholder('Choisissez une catégorie de suivi actif')
		.addOptions(options);

	return new ActionRowBuilder().addComponents(select);
}

/**
 * Build the select menu for douane (Carte Shinobi) based on configuration
 */
function buildDouaneCarteSelectMenu() {
	const options = (config.douaneCarteThemes || []).map((theme) => ({
		label: theme.label,
		value: theme.key,
		description: theme.description || undefined,
		emoji: theme.emoji || undefined
	}));

	const select = new StringSelectMenuBuilder()
		.setCustomId('douane_carte_select')
		.setPlaceholder('Choisissez une demande (Carte Shinobi)')
		.addOptions(options);

	return new ActionRowBuilder().addComponents(select);
}

function buildFactionSelectRow(guild) {
	const konohaEmoji = resolveEmoji(guild, config.factionKonohaEmoji, 'Konoha', '🌿');
	const sunaEmoji = resolveEmoji(guild, config.factionSunaEmoji, 'Suna', '🏜️');
	const select = new StringSelectMenuBuilder()
		.setCustomId('wl_faction_select')
		.setPlaceholder('Choisissez votre faction')
		.addOptions(
			{ label: 'Konoha', value: 'Konoha', emoji: konohaEmoji },
			{ label: 'Suna', value: 'Suna', emoji: sunaEmoji }
		);
	return new ActionRowBuilder().addComponents(select);
}

client.on('interactionCreate', async (interaction) => {
	try {
		if (interaction.isChatInputCommand()) {
			// Journal compact des commandes
			if (interaction.commandName === 'whitelist') {
				const statusOpt = interaction.options.getString('statut');
				const nowTime = new Date().toLocaleTimeString('fr-FR', { hour12: false });
				logInfo(`Commande envoyée : /whitelist ${statusOpt} par : "${interaction.user.username}" à ${nowTime}`);
			} else {
				const where = interaction.guild ? interaction.guild.id : 'DM';
				const channelInfo = interaction.channel ? interaction.channel.id : 'unknown';
				logInfo(`[CMD] /${interaction.commandName} by ${interaction.user.tag} (${interaction.user.id}) in #${channelInfo} @ ${where}`);
			}
			if (interaction.commandName === 'ticket-panel') {
				if (!Array.isArray(config.themes) || config.themes.length === 0) {
					return interaction.reply({ content: 'Aucun thème configuré. Ajoutez des thèmes dans src/config.json.', ephemeral: true });
				}
				// Accuser immédiatement pour éviter un timeout pendant la composition d'image
				await interaction.deferReply({ ephemeral: true });

				const embed = new EmbedBuilder()
					.setTitle(config.panelTitle || 'Ouvrir un ticket auprès du staff')
					.setDescription(
						config.panelDescriptionRich ||
						"**Comment ça marche ?**\n" +
						"1) Sélectionnez votre raison dans le menu ci-dessous.\n" +
						"2) Une demande sera envoyée au staff.\n" +
						"3) Vous recevrez un MP quand votre ticket sera accepté.\n\n" +
						"**Règles de courtoisie**\n" +
						"• Merci de rester poli et respectueux.\n" +
						"• Toute forme de harcèlement est interdite."
					)
					.setColor(config.panelColor || 0x5865F2);

				// Branding: compose banner + larger logo if both provided
				const files = [];
				const bannerLocal = config.panelBannerPath ? path.resolve(process.cwd(), config.panelBannerPath) : null;
				const logoLocal = config.panelLogoPath ? path.resolve(process.cwd(), config.panelLogoPath) : null;
				const canCompose = bannerLocal && logoLocal && fs.existsSync(bannerLocal) && fs.existsSync(logoLocal);
				if (canCompose) {
					const bannerBuf = fs.readFileSync(bannerLocal);
					const logoBuf = fs.readFileSync(logoLocal);
					const logoSize = Math.max(32, Math.min(256, Number(config.logoSizePx || 96)));
					const offsetX = Number(config.logoOffsetX || 24);
					const offsetY = Number(config.logoOffsetY || 24);
					const resizedLogo = await sharp(logoBuf).resize({ width: logoSize, height: logoSize, fit: 'contain' }).png().toBuffer();
					const composed = await sharp(bannerBuf)
						.composite([{ input: resizedLogo, top: offsetY, left: offsetX }])
						.png()
						.toBuffer();
					const composedName = 'panel-composed.png';
					files.push({ attachment: composed, name: composedName });
					embed.setImage(`attachment://${composedName}`);
					// Utiliser aussi le logo comme icône auteur (optionnel)
					embed.setAuthor({ name: config.panelAuthorName || (config.panelTitle || 'Support'), iconURL: `attachment://${path.basename(logoLocal)}` });
					files.push({ attachment: logoLocal, name: path.basename(logoLocal) });
				} else {
					if (bannerLocal && fs.existsSync(bannerLocal)) {
						files.push({ attachment: bannerLocal, name: path.basename(bannerLocal) });
						embed.setImage(`attachment://${path.basename(bannerLocal)}`);
					} else if (config.panelBannerUrl) {
						embed.setImage(config.panelBannerUrl);
					}
					if (logoLocal && fs.existsSync(logoLocal)) {
						files.push({ attachment: logoLocal, name: path.basename(logoLocal) });
						embed.setAuthor({ name: config.panelAuthorName || (config.panelTitle || 'Support'), iconURL: `attachment://${path.basename(logoLocal)}` });
					} else if (config.panelLogoUrl) {
						embed.setAuthor({ name: config.panelAuthorName || (config.panelTitle || 'Support'), iconURL: config.panelLogoUrl });
					}
				}

				const guild = interaction.guild;
				let targetChannel = interaction.channel;
				if (guild && config.panelChannelId) {
					const ch = guild.channels.cache.get(config.panelChannelId) || await guild.channels.fetch(config.panelChannelId).catch(() => null);
					if (ch && ch.isTextBased && ch.type === ChannelType.GuildText) {
						targetChannel = ch;
					}
				}
				await targetChannel.send({ embeds: [embed], components: [buildThemeSelectMenu()], files });
				// Supprimer l'accusé pour qu'aucune réponse ne reste visible
				try { await interaction.deleteReply(); } catch (_) { }
			}

			if (interaction.commandName === 'wl-recap') {
				const guild = interaction.guild;
				if (!guild) return interaction.reply({ content: 'À exécuter dans un serveur.', ephemeral: true });
				await interaction.deferReply({ ephemeral: true });
				const summary = summarizeDailyByVillage();
				const embed = new EmbedBuilder()
					.setTitle('Récap Whitelist • Aujourd\'hui')
					.setColor(0x5865F2)
					.addFields(
						{ name: 'Total', value: String(summary.total), inline: true },
						{ name: 'Traitées', value: String(summary.treated), inline: true },
						{ name: 'À traiter', value: String(summary.pending), inline: true },
						{ name: 'Konoha', value: String(summary.byVillage.Konoha), inline: true },
						{ name: 'Suna', value: String(summary.byVillage.Suna), inline: true },
						{ name: 'Autre', value: String(summary.byVillage.Autre), inline: true }
					)
					.setTimestamp(new Date());
				let target = null;
				if (config.wlDailyRecapChannelId) target = interaction.client.channels.cache.get(config.wlDailyRecapChannelId) || await interaction.client.channels.fetch(config.wlDailyRecapChannelId).catch(() => null);
				if (!target || !target.isTextBased || target.type !== ChannelType.GuildText) target = interaction.channel;
				await target.send({ embeds: [embed] });
				await interaction.editReply({ content: `Récap envoyé dans <#${target.id}>` });
			}

			if (interaction.commandName === 'wl-recap-week') {
				const guild = interaction.guild;
				if (!guild) return interaction.reply({ content: 'À exécuter dans un serveur.', ephemeral: true });
				await interaction.deferReply({ ephemeral: true });
				const perReviewer = summarizeWeeklyByReviewer();
				const fields = Object.entries(perReviewer).map(([rid, count]) => ({ name: rid === 'unknown' ? 'Inconnu' : `<@${rid}>`, value: String(count), inline: true }));
				if (fields.length === 0) fields.push({ name: 'Aucune décision', value: '—', inline: false });
				const embed = new EmbedBuilder()
					.setTitle('Récap Douanier • Cette semaine')
					.setColor(0x57F287)
					.addFields(fields)
					.setTimestamp(new Date());
				let target = null;
				if (config.wlWeeklyRecapChannelId) target = interaction.client.channels.cache.get(config.wlWeeklyRecapChannelId) || await interaction.client.channels.fetch(config.wlWeeklyRecapChannelId).catch(() => null);
				if (!target || !target.isTextBased || target.type !== ChannelType.GuildText) target = interaction.channel;
				await target.send({ embeds: [embed] });
				await interaction.editReply({ content: `Récap envoyé dans <#${target.id}>` });
			}

			if (interaction.commandName === 'oral') {
				const guild = interaction.guild;
				if (!guild) return interaction.reply({ content: 'À exécuter dans un serveur.', ephemeral: true });
				if (config.oralChannelId && interaction.channelId !== config.oralChannelId) {
					return interaction.reply({ content: `Utilisez cette commande dans <#${config.oralChannelId}>.`, ephemeral: true });
				}
				await interaction.deferReply({ ephemeral: true });
				const target = interaction.options.getUser('joueur', true);
				const questions = getOralQuestions();
				if (questions.length === 0) return interaction.editReply({ content: 'Aucune question définie (oralQuestions).' });
				const state = { targetUserId: target.id, reviewerId: interaction.user.id, responses: new Map(), page: 0 };
				const payload = buildOralPayload(state);
				// Répondre directement avec le formulaire en message éphémère (stable)
				await interaction.editReply({ content: null, ...payload });
				const sent = await interaction.fetchReply();
				activeOrals.set(sent.id, state);
				// Ajoute un petit accusé en log (facultatif)
				logInfo(`[ORAL] démarré pour ${target.tag} par ${interaction.user.tag}`);
			}

			if (interaction.commandName === 'wl-grant') {
				const guild = interaction.guild;
				if (!guild) return interaction.reply({ content: 'À exécuter dans un serveur.', ephemeral: true });
				// Restreindre au salon commandes WL si configuré
				if (config.wlCommandsChannelId && interaction.channelId !== config.wlCommandsChannelId) {
					return interaction.reply({ content: `Utilisez cette commande dans <#${config.wlCommandsChannelId}>.`, ephemeral: true });
				}
				await interaction.deferReply({ ephemeral: true });
				const user = interaction.options.getUser('membre', true);
				if (!config.whitelistRoleId) {
					return interaction.editReply({ content: 'Rôle Whitelist non configuré (whitelistRoleId).' });
				}
				try {
					const member = await guild.members.fetch(user.id).catch(() => null);
					if (!member) return interaction.editReply({ content: 'Membre introuvable sur ce serveur.' });
					await member.roles.add(config.whitelistRoleId);
					await interaction.editReply({ content: `Rôle Whitelist attribué à ${user.tag}.` });
					// Log dans le channel WL
					if (config.wlDailyRecapChannelId) {
						const logCh = interaction.client.channels.cache.get(config.wlDailyRecapChannelId) || await interaction.client.channels.fetch(config.wlDailyRecapChannelId).catch(() => null);
						if (logCh && logCh.isTextBased && logCh.type === ChannelType.GuildText) {
							const embed = new EmbedBuilder()
								.setTitle('Attribution Whitelist')
								.setColor(0x57F287)
								.setDescription(`Par ${interaction.user} → à ${member}`)
								.setTimestamp(new Date());
							await logCh.send({ embeds: [embed] });
						}
					}
				} catch (e) {
					originalConsole.error('Erreur attribution WL via commande:', e);
					await interaction.editReply({ content: 'Impossible d\'attribuer le rôle (permissions/hierarchie).' });
				}
			}

			// playerwl supprimée

			if (interaction.commandName === 'whitelist') {
				await interaction.deferReply({ ephemeral: true });
				const status = interaction.options.getString('statut');
				const isOn = status === 'on';
				const embed = new EmbedBuilder()
					.setTitle(isOn ? (config.whitelistOnTitle || 'Whitelist • ON') : (config.whitelistOffTitle || 'Whitelist • OFF'))
					.setDescription(
						(isOn ? (config.whitelistOnDescription || 'La whitelist est actuellement activée.') : (config.whitelistOffDescription || 'La whitelist est actuellement désactivée.')) +
						(() => {
							const roleId = config.nonWhitelistRoleId;
							const roleName = config.nonWhitelistRoleName || 'Non Whitelist';
							if (roleId && interaction.guild?.roles?.cache?.get(roleId)) return `\n\nRôle concerné: <@&${roleId}>`;
							return roleName ? `\n\nRôle concerné: ${roleName}` : '';
						})()
					)
					.setColor(isOn ? (config.whitelistOnColor || 0x57F287) : (config.whitelistOffColor || 0xED4245));

				const files = [];
				const bannerPath = isOn ? config.whitelistOnBannerPath : config.whitelistOffBannerPath;
				const bannerLocal = bannerPath ? path.resolve(process.cwd(), bannerPath) : null;
				if (bannerLocal && fs.existsSync(bannerLocal)) {
					files.push({ attachment: bannerLocal, name: path.basename(bannerLocal) });
					embed.setImage(`attachment://${path.basename(bannerLocal)}`);
				} else {
					const bannerUrl = isOn ? config.whitelistOnBannerUrl : config.whitelistOffBannerUrl;
					if (bannerUrl) embed.setImage(bannerUrl);
				}

				let targetChannel = interaction.channel;
				const guild = interaction.guild;
				const panelId = config.panelChannelId;
				if (guild && panelId) {
					const ch = guild.channels.cache.get(panelId) || await guild.channels.fetch(panelId).catch(() => null);
					if (ch && ch.isTextBased && ch.type === ChannelType.GuildText) targetChannel = ch;
				}

				await targetChannel.send({ content: '@everyone', embeds: [embed], files, allowedMentions: { parse: ['everyone'] } });
				try { await interaction.deleteReply(); } catch (_) { }
			}
		}

		if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_theme_select') {
			// Journal compact des sélections
			// Déférer rapidement pour éviter le timeout des interactions
			try { await interaction.deferReply({ ephemeral: true }); } catch (_) { }
			logInfo(`[SELECT] ${interaction.values[0]} by ${interaction.user.tag} (${interaction.user.id}) in #${interaction.channel?.id}`);
			const selectedKey = interaction.values[0];
			const theme = (config.themes || []).find((t) => t.key === selectedKey);
			if (!theme) {
				try { await interaction.editReply({ content: 'Thème inconnu.' }); } catch (_) { }
				return;
			}

			// Resolve category by ID or by name
			let categoryId = config.ticketCategoryId;
			const categoryName = config.ticketCategoryName;

			const guild = interaction.guild;
			if (!guild) {
				try { await interaction.editReply({ content: 'Cette interaction doit se faire dans un serveur.' }); } catch (_) { }
				return;
			}

			if (!categoryId && categoryName) {
				const found = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === String(categoryName).toLowerCase());
				if (found) {
					categoryId = found.id;
				}
			}

			if (!categoryId) {
				try { await interaction.editReply({ content: 'Configuration invalide: renseignez `ticketCategoryId` ou `ticketCategoryName` dans src/config.json' }); } catch (_) { }
				return;
			}
			// Vérifier que la catégorie existe bien et est une catégorie
			const categoryObj = await guild.channels.fetch(categoryId).catch(() => null);
			if (!categoryObj || categoryObj.type !== ChannelType.GuildCategory) {
				logInfo(`[TICKET][ERROR] Catégorie introuvable ou invalide: ${categoryId}`);
				try { await interaction.editReply({ content: "Catégorie 'Mes Tickets' introuvable. Vérifiez l'ID dans src/config.json." }); } catch (_) { }
				return;
			}

			// Vérifier permissions du bot pour créer des salons
			const me = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
			if (!me || !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
				try { await interaction.editReply({ content: "Je n'ai pas la permission 'Gérer les salons'. Demandez à un admin de me l'accorder." }); } catch (_) { }
				return;
			}

			const requester = interaction.user;
			const safeUser = requester.username.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 24);
			const channelName = `ticket-${safeUser}`.slice(0, 90);

			const everyoneRoleId = guild.roles.everyone.id;
			let staffRoleId = theme.staffRoleId;
			if (!staffRoleId && theme.staffRoleName) {
				const role = guild.roles.cache.find((r) => r.name.toLowerCase() === String(theme.staffRoleName).toLowerCase());
				if (role) {
					staffRoleId = role.id;
				}
			}
			// Fallback sur un rôle par défaut depuis la config si non résolu
			if (!staffRoleId && config.defaultStaffRoleId) {
				staffRoleId = config.defaultStaffRoleId;
			}
			if (!staffRoleId && config.defaultStaffRoleName) {
				const role = guild.roles.cache.find((r) => r.name.toLowerCase() === String(config.defaultStaffRoleName).toLowerCase());
				if (role) {
					staffRoleId = role.id;
				}
			}
			// Staff facultatif: si non résolu, on continue sans le rôle

			// Éviter les doublons: si un ticket pour cet utilisateur existe déjà sous la catégorie
			const duplicate = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.parentId === categoryId && c.name === `ticket-${requester.username.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 24)}`);
			if (duplicate) {
				try { await interaction.editReply({ content: `Vous avez déjà un ticket ouvert: <#${duplicate.id}>` }); } catch (_) { }
				return;
			}

			// Create the private text channel under the configured category
			let created;
			try {
				// Tentative 1: créer directement sous la catégorie
				created = await guild.channels.create({
					name: channelName,
					type: ChannelType.GuildText,
					parent: categoryId,
					permissionOverwrites: (() => {
						const base = [
							{ id: everyoneRoleId, deny: [PermissionFlagsBits.ViewChannel] },
							{ id: requester.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
							{ id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] }
						];
						if (staffRoleId) base.push({ id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
						return base;
					})()
				});
			} catch (e) {
				// Tentative 2: créer puis déplacer sous la catégorie (compatibilité)
				try {
					created = await guild.channels.create({
						name: channelName,
						type: ChannelType.GuildText,
						permissionOverwrites: (() => {
							const base = [
								{ id: everyoneRoleId, deny: [PermissionFlagsBits.ViewChannel] },
								{ id: requester.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
								{ id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] }
							];
							if (staffRoleId) base.push({ id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
							return base;
						})()
					});
					await created.setParent(categoryId, { lockPermissions: false }).catch(() => { });
				} catch (e2) {
					logInfo(`[TICKET][ERROR] Echec création du salon: ${e?.message || e}`);
					try { await interaction.editReply({ content: "Impossible de créer le ticket (permissions ou catégorie). Un admin doit vérifier la configuration." }); } catch (_) { }
					return;
				}
			}

			const introEmbed = new EmbedBuilder()
				.setTitle(`Ticket • ${theme.label}`)
				.setDescription(theme.welcomeMessage || `Bonjour <@${requester.id}> ! Un membre de l'équipe <@&${staffRoleId}> va vous répondre. Décrivez votre demande.`)
				.setColor(theme.color || 0x57F287);

			await created.send({
				content: staffRoleId ? `<@${requester.id}> <@&${staffRoleId}>` : `<@${requester.id}>`,
				embeds: [introEmbed],
				components: [buildCloseButtonRow()]
			});

			// Confirmer à l'utilisateur
			try { await interaction.editReply({ content: `Ticket créé: <#${created.id}>` }); } catch (_) { }

			// Log compact de la création de ticket
			logInfo(`[TICKET] created theme=${theme.key} by ${requester.tag} (${requester.id}) in #${created.id}`);
		}

		// Sélections de suivi → création d'un ticket de suivi dans la catégorie configurée
		if (interaction.isStringSelectMenu() && interaction.customId === 'suivi_select') {
			try { await interaction.deferReply({ ephemeral: true }); } catch (_) { }
			logInfo(`[SUIVI][SELECT] ${interaction.values[0]} by ${interaction.user.tag} (${interaction.user.id}) in #${interaction.channel?.id}`);
			const selectedKey = interaction.values[0];
			const theme = (config.suiviThemes || []).find((t) => t.key === selectedKey);
			if (!theme) {
				try { await interaction.editReply({ content: 'Catégorie de suivi inconnue.' }); } catch (_) { }
				return;
			}

			const guild = interaction.guild;
			if (!guild) {
				try { await interaction.editReply({ content: 'Cette interaction doit se faire dans un serveur.' }); } catch (_) { }
				return;
			}

			let categoryId = config.suiviCategoryId;
			const categoryName = config.suiviCategoryName;
			if (!categoryId && categoryName) {
				const found = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === String(categoryName).toLowerCase());
				if (found) categoryId = found.id;
			}
			if (!categoryId) {
				try { await interaction.editReply({ content: 'Configuration invalide: renseignez `suiviCategoryId` ou `suiviCategoryName` dans src/config.json' }); } catch (_) { }
				return;
			}
			const categoryObj = await guild.channels.fetch(categoryId).catch(() => null);
			if (!categoryObj || categoryObj.type !== ChannelType.GuildCategory) {
				logInfo(`[SUIVI][ERROR] Catégorie introuvable ou invalide: ${categoryId}`);
				try { await interaction.editReply({ content: "Catégorie 'Suivi' introuvable. Vérifiez l'ID dans src/config.json." }); } catch (_) { }
				return;
			}

			// Permissions
			const me = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
			if (!me || !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
				try { await interaction.editReply({ content: "Je n'ai pas la permission 'Gérer les salons'." }); } catch (_) { }
				return;
			}

			const requester = interaction.user;
			const safeUser = requester.username.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 24);
			const channelName = `suivi-${safeUser}`.slice(0, 90);
			const everyoneRoleId = guild.roles.everyone.id;
			let staffRoleId = theme.staffRoleId;
			if (!staffRoleId && theme.staffRoleName) {
				const role = guild.roles.cache.find((r) => r.name.toLowerCase() === String(theme.staffRoleName).toLowerCase());
				if (role) staffRoleId = role.id;
			}
			if (!staffRoleId && config.defaultSuiviStaffRoleId) staffRoleId = config.defaultSuiviStaffRoleId;
			if (!staffRoleId && config.defaultSuiviStaffRoleName) {
				const role = guild.roles.cache.find((r) => r.name.toLowerCase() === String(config.defaultSuiviStaffRoleName).toLowerCase());
				if (role) staffRoleId = role.id;
			}

			const duplicate = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.parentId === categoryId && c.name === channelName);
			if (duplicate) {
				try { await interaction.editReply({ content: `Vous avez déjà un ticket de suivi ouvert: <#${duplicate.id}>` }); } catch (_) { }
				return;
			}

			let created;
			try {
				created = await guild.channels.create({
					name: channelName,
					type: ChannelType.GuildText,
					parent: categoryId,
					permissionOverwrites: (() => {
						const base = [
							{ id: everyoneRoleId, deny: [PermissionFlagsBits.ViewChannel] },
							{ id: requester.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
							{ id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] }
						];
						if (staffRoleId) base.push({ id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
						return base;
					})()
				});
			} catch (e) {
				try {
					created = await guild.channels.create({
						name: channelName,
						type: ChannelType.GuildText,
						permissionOverwrites: (() => {
							const base = [
								{ id: everyoneRoleId, deny: [PermissionFlagsBits.ViewChannel] },
								{ id: requester.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
								{ id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] }
							];
							if (staffRoleId) base.push({ id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
							return base;
						})()
					});
					await created.setParent(categoryId, { lockPermissions: false }).catch(() => { });
				} catch (e2) {
					logInfo(`[SUIVI][ERROR] Echec création du salon: ${e?.message || e}`);
					try { await interaction.editReply({ content: "Impossible de créer le ticket de suivi (permissions ou catégorie)." }); } catch (_) { }
					return;
				}
			}

			const introEmbed = new EmbedBuilder()
				.setTitle(`Suivi • ${theme.label}`)
				.setDescription(theme.welcomeMessage || `Bonjour <@${requester.id}> ! L'équipe de suivi <@&${staffRoleId}> vous répondra. Décrivez votre besoin.`)
				.setColor(theme.color || 0x5865F2);

			await created.send({
				content: staffRoleId ? `<@${requester.id}> <@&${staffRoleId}>` : `<@${requester.id}>`,
				embeds: [introEmbed],
				components: [buildCloseButtonRow()]
			});

			try { await interaction.editReply({ content: `Ticket de suivi créé: <#${created.id}>` }); } catch (_) { }
			logInfo(`[SUIVI] created theme=${theme.key} by ${requester.tag} (${requester.id}) in #${created.id}`);
		}

		// Sélections de suivi actif → création d'un ticket sous catégorie dédiée
		if (interaction.isStringSelectMenu() && interaction.customId === 'suivi_actif_select') {
			try { await interaction.deferReply({ ephemeral: true }); } catch (_) { }
			logInfo(`[SUIVI_ACTIF][SELECT] ${interaction.values[0]} by ${interaction.user.tag} (${interaction.user.id}) in #${interaction.channel?.id}`);
			const selectedKey = interaction.values[0];
			const theme = (config.suiviActifThemes || []).find((t) => t.key === selectedKey);
			if (!theme) { try { await interaction.editReply({ content: 'Catégorie de suivi actif inconnue.' }); } catch (_) { } return; }

			const guild = interaction.guild; if (!guild) { try { await interaction.editReply({ content: 'Cette interaction doit se faire dans un serveur.' }); } catch (_) { } return; }

			let categoryId = config.suiviActifCategoryId || config.suiviCategoryId;
			const categoryName = config.suiviActifCategoryName;
			if (!categoryId && categoryName) {
				const found = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === String(categoryName).toLowerCase());
				if (found) categoryId = found.id;
			}
			if (!categoryId) { try { await interaction.editReply({ content: 'Configuration invalide: renseignez `suiviActifCategoryId` ou `suiviActifCategoryName`.' }); } catch (_) { } return; }
			const categoryObj = await guild.channels.fetch(categoryId).catch(() => null);
			if (!categoryObj || categoryObj.type !== ChannelType.GuildCategory) { logInfo(`[SUIVI_ACTIF][ERROR] Catégorie introuvable: ${categoryId}`); try { await interaction.editReply({ content: 'Catégorie Suivi Actif introuvable.' }); } catch (_) { } return; }

			const me = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
			if (!me || !me.permissions.has(PermissionFlagsBits.ManageChannels)) { try { await interaction.editReply({ content: "Je n'ai pas la permission 'Gérer les salons'." }); } catch (_) { } return; }

			const requester = interaction.user;
			const safeUser = requester.username.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 24);
			const channelName = `suivi-actif-${safeUser}`.slice(0, 90);
			const everyoneRoleId = guild.roles.everyone.id;
			let staffRoleId = theme.staffRoleId;
			if (!staffRoleId && theme.staffRoleName) { const role = guild.roles.cache.find((r) => r.name.toLowerCase() === String(theme.staffRoleName).toLowerCase()); if (role) staffRoleId = role.id; }
			if (!staffRoleId && config.defaultSuiviStaffRoleId) staffRoleId = config.defaultSuiviStaffRoleId;
			if (!staffRoleId && config.defaultSuiviStaffRoleName) { const role = guild.roles.cache.find((r) => r.name.toLowerCase() === String(config.defaultSuiviStaffRoleName).toLowerCase()); if (role) staffRoleId = role.id; }

			const duplicate = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.parentId === categoryId && c.name === channelName);
			if (duplicate) { try { await interaction.editReply({ content: `Vous avez déjà un ticket de suivi actif: <#${duplicate.id}>` }); } catch (_) { } return; }

			let created;
			try {
				created = await guild.channels.create({
					name: channelName,
					type: ChannelType.GuildText,
					parent: categoryId,
					permissionOverwrites: (() => {
						const base = [
							{ id: everyoneRoleId, deny: [PermissionFlagsBits.ViewChannel] },
							{ id: requester.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
							{ id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] }
						];
						if (staffRoleId) base.push({ id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
						return base;
					})()
				});
			} catch (e) {
				try {
					created = await guild.channels.create({
						name: channelName,
						type: ChannelType.GuildText,
						permissionOverwrites: (() => {
							const base = [
								{ id: everyoneRoleId, deny: [PermissionFlagsBits.ViewChannel] },
								{ id: requester.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
								{ id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] }
							];
							if (staffRoleId) base.push({ id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
							return base;
						})()
					});
					await created.setParent(categoryId, { lockPermissions: false }).catch(() => { });
				} catch (e2) {
					logInfo(`[SUIVI_ACTIF][ERROR] Echec création du salon: ${e?.message || e}`);
					try { await interaction.editReply({ content: "Impossible de créer le ticket de suivi actif." }); } catch (_) { }
					return;
				}
			}

			const introEmbed = new EmbedBuilder()
				.setTitle(`Suivi Actif • ${theme.label}`)
				.setDescription(theme.welcomeMessage || `Bonjour <@${requester.id}> ! L'équipe de suivi actif <@&${staffRoleId}> vous répondra. Décrivez votre besoin.`)
				.setColor(theme.color || 0x5865F2);
			await created.send({ content: staffRoleId ? `<@${requester.id}> <@&${staffRoleId}>` : `<@${requester.id}>`, embeds: [introEmbed], components: [buildCloseButtonRow()] });
			try { await interaction.editReply({ content: `Ticket de suivi actif créé: <#${created.id}>` }); } catch (_) { }
			logInfo(`[SUIVI_ACTIF] created theme=${theme.key} by ${requester.tag} (${requester.id}) in #${created.id}`);
		}

		// Sélections douane Carte Shinobi → création d'un ticket dans catégorie douane
		if (interaction.isStringSelectMenu() && interaction.customId === 'douane_carte_select') {
			try { await interaction.deferReply({ ephemeral: true }); } catch (_) { }
			logInfo(`[DOUANE][SELECT] ${interaction.values[0]} by ${interaction.user.tag} (${interaction.user.id}) in #${interaction.channel?.id}`);
			const selectedKey = interaction.values[0];
			const theme = (config.douaneCarteThemes || []).find((t) => t.key === selectedKey);
			if (!theme) { try { await interaction.editReply({ content: 'Demande inconnue.' }); } catch (_) { } return; }

			const guild = interaction.guild; if (!guild) { try { await interaction.editReply({ content: 'À exécuter dans un serveur.' }); } catch (_) { } return; }

			let categoryId = config.douaneCarteCategoryId;
			const categoryName = config.douaneCarteCategoryName;
			if (!categoryId && categoryName) {
				const found = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === String(categoryName).toLowerCase());
				if (found) categoryId = found.id;
			}
			if (!categoryId) { try { await interaction.editReply({ content: 'Configuration invalide: renseignez douaneCarteCategoryId/Name.' }); } catch (_) { } return; }
			const categoryObj = await guild.channels.fetch(categoryId).catch(() => null);
			if (!categoryObj || categoryObj.type !== ChannelType.GuildCategory) { try { await interaction.editReply({ content: 'Catégorie Carte Shinobi introuvable.' }); } catch (_) { } return; }

			const me = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
			if (!me || !me.permissions.has(PermissionFlagsBits.ManageChannels)) { try { await interaction.editReply({ content: "Je n'ai pas la permission 'Gérer les salons'." }); } catch (_) { } return; }

			const requester = interaction.user;
			const safeUser = requester.username.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 24);
			const channelName = `douane-${safeUser}`.slice(0, 90);
			const everyoneRoleId = guild.roles.everyone.id;
			let staffRoleId = theme.staffRoleId || config.douaneDefaultStaffRoleId;
			if (!staffRoleId && (theme.staffRoleName || config.douaneDefaultStaffRoleName)) {
				const roleName = theme.staffRoleName || config.douaneDefaultStaffRoleName;
				const role = guild.roles.cache.find((r) => r.name.toLowerCase() === String(roleName).toLowerCase());
				if (role) staffRoleId = role.id;
			}

			const duplicate = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.parentId === categoryId && c.name === channelName);
			if (duplicate) { try { await interaction.editReply({ content: `Vous avez déjà une demande ouverte: <#${duplicate.id}>` }); } catch (_) { } return; }

			let created;
			try {
				created = await guild.channels.create({
					name: channelName,
					type: ChannelType.GuildText,
					parent: categoryId,
					permissionOverwrites: (() => {
						const base = [
							{ id: everyoneRoleId, deny: [PermissionFlagsBits.ViewChannel] },
							{ id: requester.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
							{ id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] }
						];
						if (staffRoleId) base.push({ id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
						return base;
					})()
				});
			} catch (e) {
				try {
					created = await guild.channels.create({
						name: channelName,
						type: ChannelType.GuildText,
						permissionOverwrites: (() => {
							const base = [
								{ id: everyoneRoleId, deny: [PermissionFlagsBits.ViewChannel] },
								{ id: requester.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
								{ id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] }
							];
							if (staffRoleId) base.push({ id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
							return base;
						})()
					});
					await created.setParent(categoryId, { lockPermissions: false }).catch(() => { });
				} catch (e2) {
					try { await interaction.editReply({ content: "Impossible de créer le ticket douane." }); } catch (_) { }
					return;
				}
			}

			const introEmbed = new EmbedBuilder()
				.setTitle(`Douane • ${theme.label}`)
				.setDescription(theme.welcomeMessage || `Bonjour <@${requester.id}> ! La douane <@&${staffRoleId}> vous répondra. Décrivez votre demande.`)
				.setColor(theme.color || 0x5865F2);
			await created.send({ content: staffRoleId ? `<@${requester.id}> <@&${staffRoleId}>` : `<@${requester.id}>`, embeds: [introEmbed], components: [buildCloseButtonRow()] });
			try { await interaction.editReply({ content: `Demande douane créée: <#${created.id}>` }); } catch (_) { }
		}

		// Sélection de la faction pour préremplir le formulaire
		if (interaction.isStringSelectMenu() && interaction.customId === 'wl_faction_select') {
			try {
				const choice = interaction.values[0];
				pendingFactionByUser.set(interaction.user.id, choice);
				// Ouvrir ensuite le modal avec les champs
				const modal = new ModalBuilder()
					.setCustomId('whitelist_modal')
					.setTitle('Candidature Whitelist');

				const identity = new TextInputBuilder()
					.setCustomId('identity')
					.setLabel('Nom Prénom du personnage')
					.setStyle(TextInputStyle.Short)
					.setRequired(true);

				const background = new TextInputBuilder()
					.setCustomId('background')
					.setLabel('Background')
					.setStyle(TextInputStyle.Paragraph)
					.setRequired(true);

				const objectives = new TextInputBuilder()
					.setCustomId('objectives')
					.setLabel('Objectifs')
					.setStyle(TextInputStyle.Paragraph)
					.setRequired(true);

				const experience = new TextInputBuilder()
					.setCustomId('experience')
					.setLabel('Expérience RP')
					.setStyle(TextInputStyle.Paragraph)
					.setRequired(true);

				modal.addComponents(
					new ActionRowBuilder().addComponents(identity),
					new ActionRowBuilder().addComponents(background),
					new ActionRowBuilder().addComponents(objectives),
					new ActionRowBuilder().addComponents(experience)
				);

				await interaction.showModal(modal);
			} catch (err) {
				originalConsole.error('Erreur sélection faction:', err);
			}
		}

		if (interaction.isButton() && interaction.customId === 'ticket_close') {
			// Journal compact du bouton
			logInfo(`[BUTTON] ticket_close by ${interaction.user.tag} (${interaction.user.id}) in #${interaction.channel?.id}`);
			const channel = interaction.channel;
			if (!channel || channel.type !== ChannelType.GuildText) {
				return interaction.reply({ content: 'Cette action doit être faite dans un salon de ticket.', ephemeral: true });
			}

			await interaction.deferReply({ ephemeral: true });

			// Lock the channel for the ticket opener (best-effort)
			const overwrites = channel.permissionOverwrites.cache;
			const openerOverwrite = [...overwrites.values()].find((ow) => ow.type === 1); // MEMBER overwrite likely for opener
			if (openerOverwrite) {
				await channel.permissionOverwrites.edit(openerOverwrite.id, { SendMessages: false }).catch(() => { });
			}

			await channel.send({ content: 'Ticket en cours de fermeture. Le salon sera supprimé dans 15 secondes.' });

			// Log compact de la fermeture de ticket
			logInfo(`[TICKET] closed #${channel.id} by ${interaction.user.tag} (${interaction.user.id})`);

			setTimeout(async () => {
				await channel.delete('Ticket fermé').catch(() => { });
			}, 15000);

			await interaction.editReply({ content: 'Fermeture planifiée. Merci !' });
		}

		// Boutons accept/refuse sur une candidature
		if (interaction.isButton() && (interaction.customId.startsWith('wl_accept_') || interaction.customId.startsWith('wl_reject_'))) {
			try {
				const targetUserId = interaction.customId.split('_').pop();
				const isAccept = interaction.customId.startsWith('wl_accept_');
				const statusText = isAccept ? 'ACCEPTÉE' : 'REFUSÉE';
				await interaction.deferReply({ ephemeral: true });
				// Mettre à jour le message avec un tag de statut
				const msg = interaction.message;
				const embed = msg.embeds?.[0] ? EmbedBuilder.from(msg.embeds[0]) : new EmbedBuilder();
				embed.setFooter({ text: `Décision: ${statusText} par ${interaction.user.tag}` }).setColor(isAccept ? 0x57F287 : 0xED4245);
				await msg.edit({ embeds: [embed], components: [] });

				// store decision
				markDecision(targetUserId, msg.id, isAccept ? 'accepted' : 'rejected', interaction.user.id, 'form');

				// log accepter/review dans channel WL logs
				try {
					if (config.wlDailyRecapChannelId) {
						const logCh = interaction.client.channels.cache.get(config.wlDailyRecapChannelId) || await interaction.client.channels.fetch(config.wlDailyRecapChannelId).catch(() => null);
						if (logCh && logCh.isTextBased && logCh.type === ChannelType.GuildText) {
							if (isAccept) {
								const acceptedFormToday = countReviewerAcceptedTodayByStage(interaction.user.id, 'form');
								const embed = new EmbedBuilder()
									.setTitle('Candidature acceptée (Formulaire)')
									.setColor(0x57F287)
									.setDescription(`Par ${interaction.user} → pour <@${targetUserId}>`)
									.addFields({ name: 'Formulaires acceptés aujourd\'hui (agent)', value: String(acceptedFormToday), inline: true })
									.setTimestamp(new Date());
								await logCh.send({ embeds: [embed] });
								// Annonce de résultat dans le salon des résultats
								try {
									const resultGuildId = config.whitelistApplyGuildId;
									const resultChannelId = config.whitelistResultChannelId;
									if (resultGuildId && resultChannelId) {
										const g = interaction.client.guilds.cache.get(resultGuildId) || await interaction.client.guilds.fetch(resultGuildId).catch(() => null);
										const ch = g ? (g.channels.cache.get(resultChannelId) || await g.channels.fetch(resultChannelId).catch(() => null)) : null;
										if (ch && ch.isTextBased && ch.type === ChannelType.GuildText) {
											const resEmbed = new EmbedBuilder()
												.setTitle('Résultat • Questionnaire validé')
												.setColor(0x57F287)
												.setDescription(`<@${targetUserId}> a validé son questionnaire. Félicitations ! Vous pouvez maintenant passer à l\'entretien vocal.`)
												.setTimestamp(new Date());
											await ch.send({ content: `<@${targetUserId}>`, embeds: [resEmbed] });
										}
									}
								} catch (_) { }
							} else {
								const embed = new EmbedBuilder()
									.setTitle('Candidature refusée (Formulaire)')
									.setColor(0xED4245)
									.setDescription(`Par ${interaction.user} → pour <@${targetUserId}>`)
									.setTimestamp(new Date());
								await logCh.send({ embeds: [embed] });
							}
						}
					}
				} catch (_) { }

				// Si accepté: attribuer le rôle Entretien Vocal (et non Whitelist)
				if (isAccept && config.entretienVocalRoleId && config.whitelistApplyGuildId) {
					try {
						const guild = interaction.client.guilds.cache.get(config.whitelistApplyGuildId) || await interaction.client.guilds.fetch(config.whitelistApplyGuildId);
						const member = await guild.members.fetch(targetUserId).catch(() => null);
						if (member) {
							await member.roles.add(config.entretienVocalRoleId).catch(() => { });
						}
					} catch (e) {
						originalConsole.error('Erreur attribution rôle whitelist:', e);
					}
				}
				await interaction.editReply({ content: `Candidature ${statusText.toLowerCase()}.` });
				logInfo(`[APPLY] décision ${statusText} par ${interaction.user.tag} (${interaction.user.id}) sur ${targetUserId}`);
			} catch (err) {
				originalConsole.error('Erreur décision candidature:', err);
			}
		}

		// Sélecteurs Oral: validé/refusé par question
		if (interaction.isStringSelectMenu() && interaction.customId.startsWith('oral_sel_')) {
			const msg = interaction.message;
			const state = activeOrals.get(msg.id);
			if (!state) return interaction.reply({ content: 'Ce formulaire oral n\'est plus actif.', ephemeral: true });
			if (interaction.user.id !== state.reviewerId) return interaction.reply({ content: 'Seul l\'agent qui a démarré cet oral peut répondre.', ephemeral: true });
			const idx = Number(interaction.customId.split('_').pop());
			const choice = interaction.values?.[0] === 'yes';
			state.responses.set(idx, choice);
			// Recalcul du score
			let score = 0; for (const v of state.responses.values()) if (v) score++;
			const total = Math.min(15, getOralQuestions().length);
			const done = state.responses.size >= total;
			if (done) {
				// décision finale automatique
				const pass = score > 10;
				if (pass && config.whitelistRoleId && config.whitelistApplyGuildId) {
					try {
						const guild = interaction.client.guilds.cache.get(config.whitelistApplyGuildId) || await interaction.client.guilds.fetch(config.whitelistApplyGuildId);
						const member = await guild.members.fetch(state.targetUserId).catch(() => null);
						if (member) await member.roles.add(config.whitelistRoleId).catch(() => { });
						markGrantFinal(state.targetUserId, interaction.user.id);
					} catch (_) { }
				}
				// Clore et notifier
				await interaction.update({ ...buildOralPayload(state), components: [] });
				const resultText = pass ? 'Réussi (Whitelist attribuée)' : 'Échoué';
				try { await interaction.followUp({ content: `Oral terminé. Score: ${score}/${total} • ${resultText}`, ephemeral: true }); } catch (_) { }
				activeOrals.delete(msg.id);
			} else {
				await interaction.update(buildOralPayload(state));
			}
		}

		// Navigation/submit du formulaire oral
		if (interaction.isButton() && (interaction.customId === 'oral_prev' || interaction.customId === 'oral_next' || interaction.customId === 'oral_submit')) {
			const msg = interaction.message;
			const state = activeOrals.get(msg.id);
			if (!state) return interaction.reply({ content: 'Ce formulaire oral n\'est plus actif.', ephemeral: true });
			if (interaction.user.id !== state.reviewerId) return interaction.reply({ content: 'Seul l\'agent qui a démarré cet oral peut répondre.', ephemeral: true });
			if (interaction.customId === 'oral_prev') { state.page = Math.max(0, (state.page || 0) - 1); await interaction.update(buildOralPayload(state)); return; }
			if (interaction.customId === 'oral_next') { const max = Math.max(0, Math.ceil(getOralQuestions().length / ORAL_PAGE_SIZE) - 1); state.page = Math.min(max, (state.page || 0) + 1); await interaction.update(buildOralPayload(state)); return; }
			if (interaction.customId === 'oral_submit') {
				let score = 0; for (const v of state.responses.values()) if (v) score++;
				const total = Math.min(15, getOralQuestions().length);
				const pass = score > 10;
				if (pass && config.whitelistRoleId && config.whitelistApplyGuildId) {
					try {
						const guild = interaction.client.guilds.cache.get(config.whitelistApplyGuildId) || await interaction.client.guilds.fetch(config.whitelistApplyGuildId);
						const member = await guild.members.fetch(state.targetUserId).catch(() => null);
						if (member) await member.roles.add(config.whitelistRoleId).catch(() => { });
						markGrantFinal(state.targetUserId, interaction.user.id);
					} catch (_) { }
				}
				await interaction.update({ ...buildOralPayload(state), components: [] });
				try { await interaction.followUp({ content: `Oral terminé. Score: ${score}/${total} • ${pass ? 'Réussi (Whitelist attribuée)' : 'Échoué'}`, ephemeral: true }); } catch (_) { }
				activeOrals.delete(msg.id);
			}
		}

		// Réception du formulaire (modal) whitelist
		if (interaction.isModalSubmit() && interaction.customId === 'whitelist_modal') {
			try {
				const faction = pendingFactionByUser.get(interaction.user.id) || 'Non précisé';
				const identity = interaction.fields.getTextInputValue('identity');
				const background = interaction.fields.getTextInputValue('background');
				const objectives = interaction.fields.getTextInputValue('objectives');
				const experience = interaction.fields.getTextInputValue('experience');

				const resultGuildId = config.whitelistApplyGuildId;
				const resultChannelId = config.whitelistResultChannelId;
				let posted = false;
				try {
					const guild = interaction.client.guilds.cache.get(resultGuildId) || await interaction.client.guilds.fetch(resultGuildId);
					// Priorité au form channel name, sinon fallback sur resultChannelId
					let targetChannel = null;
					if (config.whitelistFormChannelName) {
						targetChannel = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === String(config.whitelistFormChannelName));
					}
					if (!targetChannel && resultChannelId) {
						targetChannel = guild.channels.cache.get(resultChannelId) || await guild.channels.fetch(resultChannelId).catch(() => null);
					}
					if (targetChannel && targetChannel.isTextBased && targetChannel.type === ChannelType.GuildText) {
						const embed = new EmbedBuilder()
							.setTitle('Candidature Whitelist')
							.setColor(0x57F287)
							.setDescription(`Soumise par **${interaction.user.tag}** (${interaction.user.id})`)
							.addFields(
								{ name: 'Faction', value: faction || '—', inline: true },
								{ name: 'Identité', value: identity || '—', inline: true },
								{ name: 'Background', value: background?.slice(0, 1024) || '—' },
								{ name: 'Objectifs', value: objectives?.slice(0, 1024) || '—' },
								{ name: 'Expérience RP', value: experience?.slice(0, 1024) || '—' }
							)
							.setTimestamp(new Date());
						const actions = new ActionRowBuilder().addComponents(
							new ButtonBuilder().setCustomId(`wl_accept_${interaction.user.id}`).setLabel('Accepter').setStyle(ButtonStyle.Success),
							new ButtonBuilder().setCustomId(`wl_reject_${interaction.user.id}`).setLabel('Refuser').setStyle(ButtonStyle.Danger)
						);
						const sent = await targetChannel.send({ embeds: [embed], components: [actions] });
						// log store
						upsertSubmission({
							userId: interaction.user.id,
							messageId: sent.id,
							submittedAt: new Date().toISOString(),
							guildId: guild.id,
							channelId: sent.channelId,
							faction,
							identity
						});
						posted = true;
					}
				} catch (e) {
					originalConsole.error('Erreur envoi candidature dans le salon formulaire-wl:', e);
				}

				await interaction.reply({ ephemeral: true, content: posted ? 'Votre candidature a été envoyée. Merci !' : 'Votre candidature a été enregistrée. Merci !' });
				pendingFactionByUser.delete(interaction.user.id);
				logInfo(`[APPLY] formulaire soumis par ${interaction.user.tag} (${interaction.user.id}) faction=${faction}`);
			} catch (err) {
				originalConsole.error('Erreur traitement formulaire whitelist:', err);
				try { await interaction.reply({ ephemeral: true, content: 'Une erreur est survenue lors de la soumission.' }); } catch (_) { }
			}
		}

		// Bouton devenir whitelist → demander la faction puis ouvrir le formulaire
		if (interaction.isButton() && interaction.customId === 'whitelist_apply') {
			await interaction.reply({ ephemeral: true, content: 'Choisissez votre faction :', components: [buildFactionSelectRow(interaction.guild)] });
		}
	} catch (error) {
		console.error('[interaction error]', error);
		if (interaction.isRepliable()) {
			try {
				await interaction.reply({ content: 'Une erreur est survenue. Réessayez plus tard.', ephemeral: true });
			} catch (_) {
				// ignore double reply errors
			}
		}
	}
});

// Gestion d'erreurs globales
// On conserve la sortie d'erreur en console uniquement, sans spammer le salon
client.on('error', (err) => {
	originalConsole.error('[client error]', err);
});
process.on('unhandledRejection', (reason) => {
	originalConsole.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
	originalConsole.error('[uncaughtException]', err);
});

// === DEBUG: Raw Packet Listener ===
client.on('raw', (packet) => {
	if (packet.t === 'GUILD_MEMBER_ADD') {
		originalConsole.log('[DEBUG-RAW] Packet GUILD_MEMBER_ADD reçu de Discord ! (L\'intent fonctionne)');
	}
});

// === Welcome Widget Handler ===
client.on('guildMemberAdd', async (member) => {
	originalConsole.log(`[DEBUG-HARD] Event guildMemberAdd triggered for ${member.user.tag}`);
	try {
		console.log(`[WELCOME] Nouveau membre: ${member.user.tag} (${member.id})`);

		// Auto-role assignment
		const autoRoleID = '1423236972729864222';
		try {
			await member.roles.add(autoRoleID);
			console.log(`[AUTOROLE] Role ${autoRoleID} added to ${member.user.tag}`);
		} catch (e) {
			originalConsole.error(`[AUTOROLE] Failed to add role ${autoRoleID} to ${member.user.tag}:`, e);
		}

		// Check for channel
		let channel = null;
		console.log('[WELCOME] Recherche du salon de bienvenue...');

		if (config.welcomeChannelId) {
			console.log(`[WELCOME] config.welcomeChannelId est défini: ${config.welcomeChannelId}. Vérification du cache...`);
			channel = member.guild.channels.cache.get(config.welcomeChannelId);
		}

		// Fallback or retry fetch if not found in cache
		if (!channel && config.welcomeChannelId) {
			console.log(`[WELCOME] Salon non trouvé dans le cache. Tentative de fetch via l'API pour l'ID ${config.welcomeChannelId}...`);
			channel = await member.guild.channels.fetch(config.welcomeChannelId).catch(() => null);
		}

		if (channel) {
			console.log(`[WELCOME] SUCCÈS: Salon trouvé par ID: #${channel.name} (${channel.id})`);
		} else if (config.welcomeChannelId) {
			console.log(`[WELCOME] ÉCHEC: config.welcomeChannelId était défini mais le salon est introuvable.`);
		}

		// Auto-detect if not configured
		if (!channel) {
			console.log('[WELCOME] Tentative de détection automatique (mots-clés: bienvenue, welcome, arrivée, arrivées, new-player)...');
			const possibleNames = ['bienvenue', 'welcome', 'arrivée', 'arrivées', 'new-player'];
			channel = member.guild.channels.cache.find(c => c.isTextBased() && possibleNames.some(n => c.name.toLowerCase().includes(n)));

			if (channel) {
				console.log(`[WELCOME] SUCCÈS: Salon trouvé par détection automatique: #${channel.name} (${channel.id})`);
			} else {
				console.log('[WELCOME] ÉCHEC: Aucun salon correspondant aux mots-clés n\'a été trouvé.');
			}
		}

		if (!channel) {
			console.log(`[WELCOME] CRITIQUE: Aucun salon de bienvenue trouvé/configuré pour ${member.guild.name}. Abandon.`);
			return;
		}

		// Build content
		console.log('[WELCOME] Construction du message...');
		const title = config.welcomeTitle || "👋 Bienvenue Ninja !";
		const messageTemplate = config.welcomeMessage || "Hey {user}, bienvenue sur 🌌 **VOIDRP** !\nN'hésite pas à lire le {rules} pour obtenir l'accès au serveur.";

		// Resolve rules channel
		let rulesPart = "#règlement";
		const rulesChannel = member.guild.channels.cache.find(c => c.name.toLowerCase().includes('règlement') || c.name.toLowerCase().includes('rules') || c.name.toLowerCase().includes('reglement'));
		if (rulesChannel) rulesPart = `<#${rulesChannel.id}>`;

		const messageText = messageTemplate
			.replace('{user}', `<@${member.id}>`)
			.replace('{rules}', rulesPart);

		const embed = new EmbedBuilder()
			.setAuthor({
				name: member.displayName,
				iconURL: member.user.displayAvatarURL({ extension: 'png', size: 256 })
			})
			.setTitle(title)
			.setDescription(messageText)
			.setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 512 }))
			.setColor(0x2f3136) // Dark/Premium color
			.setFooter({ text: `Membre #${member.guild.memberCount}`, iconURL: member.guild.iconURL() })
			.setTimestamp();

		const files = [];
		const bannerPath = config.welcomeBannerPath ? path.resolve(process.cwd(), config.welcomeBannerPath) : null;

		if (config.welcomeBannerPath) {
			console.log(`[WELCOME] Chemin bannière configuré: "${config.welcomeBannerPath}"`);
			console.log(`[WELCOME] Chemin absolu résolu: "${bannerPath}"`);
			if (bannerPath && fs.existsSync(bannerPath)) {
				console.log('[WELCOME] Bannière trouvée sur le disque. Ajout aux fichiers joints.');
				const attachmentName = path.basename(bannerPath);
				files.push({ attachment: bannerPath, name: attachmentName });
				embed.setImage(`attachment://${attachmentName}`);
			} else {
				console.log(`[WELCOME] ÉCHEC: Le fichier de bannière n'existe pas ou le chemin est incorrect.`);
			}
		} else {
			console.log('[WELCOME] Aucune bannière configurée (config.welcomeBannerPath vide).');
		}

		console.log(`[WELCOME] Envoi du message dans #${channel.name} (${channel.id})...`);
		try {
			await channel.send({ embeds: [embed], files: files });
			console.log(`[WELCOME] SUCCÈS: Message de bienvenue envoyé pour ${member.user.tag}`);
		} catch (sendError) {
			console.log(`[WELCOME] ERREUR lors de l'envoi du message: ${sendError.message}`);
			originalConsole.error(sendError);
		}

	} catch (e) {
		console.log(`[WELCOME] CRASH/ERREUR globale dans l'event guildMemberAdd: ${e.message}`);
		originalConsole.error('[WELCOME] Erreur complète:', e);
	}
	// Mettre à jour le statut immédiatement
	updateBotStatus();
});

client.on('guildMemberRemove', (member) => {
	// Mettre à jour le statut immédiatement lors d'un départ
	updateBotStatus();
});

client.login(token);


