require('dotenv').config();
const { REST, Routes } = require('discord.js');
const commands = require('./commands');

function assertEnv(name) {
	const value = process.env[name];
	if (!value || value.trim().length === 0) {
		throw new Error(`Variable d'environnement manquante: ${name}`);
	}
	return value;
}

function parseCliGuildId() {
	const idx = process.argv.findIndex((a) => a === '--guild' || a === '-g');
	if (idx !== -1 && process.argv[idx + 1]) {
		return process.argv[idx + 1];
	}
	return undefined;
}

async function main() {
	const token = assertEnv('DISCORD_TOKEN');
	const clientId = assertEnv('CLIENT_ID');

	// Priorité: CLI --guild <id> > GUILD_IDS (séparées par ,) > GUILD_ID > global
	const cliGuild = parseCliGuildId();
	let guildIds = [];
	if (cliGuild) guildIds = [cliGuild];
	else if (process.env.GUILD_IDS) guildIds = process.env.GUILD_IDS.split(',').map((s) => s.trim()).filter(Boolean);
	else if (process.env.GUILD_ID) guildIds = [process.env.GUILD_ID.trim()];

	const rest = new REST({ version: '10' }).setToken(token);
	const body = commands.map((c) => c.toJSON());

	try {
		if (guildIds.length > 0) {
			for (const gid of guildIds) {
				console.log(`[register] Mise à jour des commandes pour la guilde ${gid}...`);
				await rest.put(Routes.applicationGuildCommands(clientId, gid), { body });
				console.log(`[register] Commandes mises à jour pour ${gid}.`);
			}
		} else {
			console.log('[register] Mise à jour des commandes globales (peut prendre jusqu\'à 1h)...');
			await rest.put(Routes.applicationCommands(clientId), { body });
			console.log('[register] Commandes globales mises à jour.');
		}
	} catch (error) {
		console.error('[register] Erreur lors de l\'enregistrement des commandes:', error);
		process.exitCode = 1;
	}
}

main();


