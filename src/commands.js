const { SlashCommandBuilder } = require('discord.js');

module.exports = [
	new SlashCommandBuilder()
		.setName('ticket-panel')
		.setDescription('Publie un panneau pour ouvrir des tickets par thème'),
	new SlashCommandBuilder()
		.setName('whitelist')
		.setDescription('Publie le statut de la whitelist (ON/OFF)')
		.addStringOption((opt) =>
			opt
				.setName('statut')
				.setDescription('ON ou OFF')
				.setRequired(true)
				.addChoices(
					{ name: 'ON', value: 'on' },
					{ name: 'OFF', value: 'off' }
				)
		)
	,
	new SlashCommandBuilder()
		.setName('wl-recap')
		.setDescription('Publie un récapitulatif des candidatures WL du jour')
	,
	new SlashCommandBuilder()
		.setName('wl-recap-week')
		.setDescription('Publie le récap hebdo des WL traitées par douaniers')
,
	new SlashCommandBuilder()
		.setName('wl-grant')
		.setDescription('Attribue le rôle Whitelist à un membre')
		.addUserOption((opt) =>
			opt.setName('membre').setDescription('Le membre à whitelister').setRequired(true)
		)
,
// playerwl supprimée
,
	new SlashCommandBuilder()
		.setName('oral')
		.setDescription('Démarre un barème d\'entretien oral pour un joueur')
		.addUserOption((opt) => opt.setName('joueur').setDescription('Joueur évalué').setRequired(true))
];
