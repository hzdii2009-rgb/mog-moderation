require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  REST,
  Routes
} = require("discord.js");

// =====================================================
// CONFIG
// =====================================================

const PREFIX = "?";
const LOG_CHANNEL_NAME = "mod-logs";

const WARNINGS_FILE = path.join(__dirname, "warnings.json");
const JOINDM_FILE = path.join(__dirname, "joindm.json");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// =====================================================
// FILE SETUP
// =====================================================

function ensureFile(file, defaultData = {}) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      JSON.stringify(defaultData, null, 2)
    );
  }
}

ensureFile(WARNINGS_FILE, {});
ensureFile(JOINDM_FILE, {});

// =====================================================
// WARNINGS
// =====================================================

function loadWarnings() {
  try {
    const data = fs.readFileSync(WARNINGS_FILE, "utf8");

    if (!data.trim()) {
      return {};
    }

    return JSON.parse(data);
  } catch (error) {
    console.error("Error loading warnings.json:", error);
    return {};
  }
}

let warnings = loadWarnings();

function saveWarnings() {
  try {
    fs.writeFileSync(
      WARNINGS_FILE,
      JSON.stringify(warnings, null, 2)
    );
  } catch (error) {
    console.error("Error saving warnings.json:", error);
  }
}

function getUserWarnings(guildId, userId) {
  if (!warnings[guildId]) {
    warnings[guildId] = {};
  }

  if (!warnings[guildId][userId]) {
    warnings[guildId][userId] = [];
  }

  return warnings[guildId][userId];
}

// =====================================================
// JOIN DM
// =====================================================

function loadJoinDM() {
  try {
    const data = fs.readFileSync(JOINDM_FILE, "utf8");

    if (!data.trim()) {
      return {};
    }

    return JSON.parse(data);
  } catch (error) {
    console.error("Error loading joindm.json:", error);
    return {};
  }
}

let joinDM = loadJoinDM();

function saveJoinDM() {
  try {
    fs.writeFileSync(
      JOINDM_FILE,
      JSON.stringify(joinDM, null, 2)
    );
  } catch (error) {
    console.error("Error saving joindm.json:", error);
  }
}

// =====================================================
// CASE NUMBERS
// =====================================================

let nextCase = 1;

function getCaseNumber() {
  const number = String(nextCase).padStart(4, "0");
  nextCase++;

  return "#" + number;
}

// =====================================================
// COLORS
// =====================================================

const COLORS = {
  success: 0x57F287,
  danger: 0xED4245,
  warning: 0xFEE75C,
  info: 0x5865F2,
  neutral: 0x2B2D31
};

// =====================================================
// EMBEDS
// =====================================================

function baseEmbed(color = COLORS.info) {
  return new EmbedBuilder()
    .setColor(color)
    .setTimestamp()
    .setFooter({
      text: "Mog Moderation"
    });
}

function errorEmbed(title, description) {
  return baseEmbed(COLORS.danger)
    .setTitle(`❌ ${title}`)
    .setDescription(description);
}

function successEmbed(title, description) {
  return baseEmbed(COLORS.success)
    .setTitle(`✅ ${title}`)
    .setDescription(description);
}

// =====================================================
// PERMISSION CHECKS
// =====================================================

function isModerator(member) {
  if (!member) return false;

  return (
    member.id === member.guild.ownerId ||
    member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  );
}

function canModerate(executor, target) {
  if (!executor || !target) {
    return false;
  }

  // Cannot moderate yourself
  if (executor.id === target.id) {
    return false;
  }

  // Server owner can moderate anyone except themselves
  if (executor.id === executor.guild.ownerId) {
    return true;
  }

  // Nobody can moderate the server owner
  if (target.id === target.guild.ownerId) {
    return false;
  }

  // Role hierarchy
  if (
    target.roles.highest.position >=
    executor.roles.highest.position
  ) {
    return false;
  }

  return true;
}

function botCanModerate(guild, target) {
  const botMember = guild.members.me;

  if (!botMember || !target) {
    return false;
  }

  return (
    target.roles.highest.position <
    botMember.roles.highest.position
  );
}

// =====================================================
// LOGGING
// =====================================================

async function sendLog(guild, embed) {
  try {
    const channel = guild.channels.cache.find(
      ch =>
        ch.name === LOG_CHANNEL_NAME &&
        ch.isTextBased()
    );

    if (!channel) {
      console.log(
        `#${LOG_CHANNEL_NAME} was not found in ${guild.name}`
      );
      return;
    }

    await channel.send({
      embeds: [embed]
    });
  } catch (error) {
    console.error("Could not send moderation log:", error);
  }
}

// =====================================================
// JOIN DM VARIABLES
// =====================================================

function replaceJoinVariables(message, member) {
  return message
    .replace(/\{user\}/gi, `<@${member.id}>`)
    .replace(/\{username\}/gi, member.user.username)
    .replace(/\{server\}/gi, member.guild.name)
    .replace(
      /\{membercount\}/gi,
      String(member.guild.memberCount)
    );
}

// =====================================================
// SLASH COMMANDS
// =====================================================

const slashCommands = [
  {
    name: "commands",
    description: "Show all Mog Moderation commands"
  },

  {
    name: "warn",
    description: "Warn a member",
    options: [
      {
        name: "user",
        description: "The member to warn",
        type: 6,
        required: true
      },
      {
        name: "reason",
        description: "Reason for the warning",
        type: 3,
        required: false
      }
    ]
  },

  {
    name: "kick",
    description: "Kick a member",
    options: [
      {
        name: "user",
        description: "The member to kick",
        type: 6,
        required: true
      },
      {
        name: "reason",
        description: "Reason for the kick",
        type: 3,
        required: false
      }
    ]
  },

  {
    name: "ban",
    description: "Ban a member",
    options: [
      {
        name: "user",
        description: "The member to ban",
        type: 6,
        required: true
      },
      {
        name: "reason",
        description: "Reason for the ban",
        type: 3,
        required: false
      }
    ]
  },

  {
    name: "mute",
    description: "Timeout a member",
    options: [
      {
        name: "user",
        description: "The member to mute",
        type: 6,
        required: true
      },
      {
        name: "duration",
        description: "Duration such as 10m, 1h, 1d",
        type: 3,
        required: true
      },
      {
        name: "reason",
        description: "Reason for the mute",
        type: 3,
        required: false
      }
    ]
  },

  {
    name: "joindm",
    description: "Set the automatic welcome DM",
    options: [
      {
        name: "message",
        description:
          "Message. Variables: {user}, {username}, {server}, {membercount}",
        type: 3,
        required: true
      }
    ]
  },

  {
    name: "editjoindm",
    description: "Edit the automatic welcome DM",
    options: [
      {
        name: "message",
        description:
          "New message. Variables: {user}, {username}, {server}, {membercount}",
        type: 3,
        required: true
      }
    ]
  },

  {
    name: "stopjoindm",
    description: "Disable the automatic welcome DM"
  }
];

// =====================================================
// DURATION PARSER
// =====================================================

function parseDuration(input) {
  if (!input) return null;

  const match = input
    .toLowerCase()
    .trim()
    .match(/^(\d+)(s|m|h|d|w)$/);

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000
  };

  return amount * multipliers[unit];
}

// =====================================================
// READY
// =====================================================

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const rest = new REST({
      version: "10"
    }).setToken(process.env.DISCORD_TOKEN);

    if (!process.env.CLIENT_ID) {
      console.error("CLIENT_ID is missing from environment variables.");
      return;
    }

    if (!process.env.GUILD_ID) {
      console.error("GUILD_ID is missing from environment variables.");
      return;
    }

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      {
        body: slashCommands
      }
    );

    console.log("Slash commands registered.");
  } catch (error) {
    console.error("Error registering slash commands:", error);
  }
});

// =====================================================
// MEMBER JOIN
// =====================================================

client.on("guildMemberAdd", async member => {
  try {
    const settings = joinDM[member.guild.id];

    if (!settings || !settings.enabled || !settings.message) {
      return;
    }

    const message = replaceJoinVariables(
      settings.message,
      member
    );

    const embed = baseEmbed(COLORS.info)
      .setTitle(`👋 Welcome to ${member.guild.name}!`)
      .setDescription(message)
      .setThumbnail(member.user.displayAvatarURL())
      .addFields({
        name: "Member",
        value: `${member.user}`,
        inline: true
      });

    await member.send({
      embeds: [embed]
    });

    console.log(
      `Sent join DM to ${member.user.tag} in ${member.guild.name}`
    );
  } catch (error) {
    console.log(
      `Could not DM ${member.user.tag}: ${error.message}`
    );
  }
});

// =====================================================
// SLASH COMMAND HANDLER
// =====================================================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (!interaction.guild) {
    return interaction.reply({
      embeds: [
        errorEmbed(
          "Server Only",
          "This command can only be used inside a server."
        )
      ],
      ephemeral: true
    });
  }

  const command = interaction.commandName;
  const member = interaction.member;

  // ===================================================
  // /commands
  // ===================================================

  if (command === "commands") {
    if (!isModerator(member)) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Access Denied",
            "Only **Server Owners and Administrators** can use this command."
          )
        ],
        ephemeral: true
      });
    }

    const embed = baseEmbed(COLORS.info)
      .setTitle("📖 Mog Moderation Commands")
      .setDescription(
        "Here are all the commands currently available."
      )
      .addFields(
        {
          name: "🛡️ Moderation",
          value:
            "`/warn @user [reason]`\n" +
            "`/kick @user [reason]`\n" +
            "`/ban @user [reason]`\n" +
            "`/mute @user <duration> [reason]`"
        },
        {
          name: "👋 Join DM",
          value:
            "`/joindm <message>`\n" +
            "`/editjoindm <message>`\n" +
            "`/stopjoindm`"
        },
        {
          name: "⌨️ Prefix Commands",
          value:
            "`?warn @user [reason]`\n" +
            "`?kick @user [reason]`\n" +
            "`?ban @user [reason]`\n" +
            "`?mute @user <duration> [reason]`\n" +
            "`?joindm <message>`\n" +
            "`?editjoindm <message>`\n" +
            "`?stopjoindm`"
        },
        {
          name: "📌 Join DM Variables",
          value:
            "`{user}` • Mention the member\n" +
            "`{username}` • Their username\n" +
            "`{server}` • Server name\n" +
            "`{membercount}` • Current member count"
        }
      )
      .setFooter({
        text: "Mog Moderation • Owner/Admin Command"
      });

    return interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  }

  // ===================================================
  // MODERATOR PERMISSION
  // ===================================================

  if (
    [
      "warn",
      "kick",
      "ban",
      "mute",
      "joindm",
      "editjoindm",
      "stopjoindm"
    ].includes(command)
  ) {
    if (!isModerator(member)) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Access Denied",
            "You need **Administrator** permission or be the **Server Owner** to use this command."
          )
        ],
        ephemeral: true
      });
    }
  }

  // ===================================================
  // /WARN
  // ===================================================

  if (command === "warn") {
    const target = interaction.options.getMember("user");
    const reason =
      interaction.options.getString("reason") ||
      "No reason provided";

    if (!target) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "User Not Found",
            "I couldn't find that member."
          )
        ],
        ephemeral: true
      });
    }

    if (!canModerate(member, target)) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Cannot Warn User",
            "You cannot warn yourself, the server owner, or a member with an equal/higher role."
          )
        ],
        ephemeral: true
      });
    }

    const userWarnings = getUserWarnings(
      interaction.guild.id,
      target.id
    );

    const caseNumber = getCaseNumber();

    userWarnings.push({
      case: caseNumber,
      reason,
      moderator: interaction.user.id,
      timestamp: new Date().toISOString()
    });

    saveWarnings();

    const embed = moderationEmbed({
      title: "⚠️ Member Warned",
      description: `${target} has been warned.`,
      target,
      moderator: interaction.user,
      reason,
      caseNumber,
      color: COLORS.warning
    }).addFields({
      name: "Total Warnings",
      value: `**${userWarnings.length}**`,
      inline: true
    });

    await interaction.reply({
      embeds: [embed]
    });

    await sendLog(interaction.guild, embed);

    try {
      await target.send({
        embeds: [
          baseEmbed(COLORS.warning)
            .setTitle("⚠️ You have been warned")
            .setDescription(
              `You received a warning in **${interaction.guild.name}**.`
            )
            .addFields(
              {
                name: "Reason",
                value: reason
              },
              {
                name: "Case",
                value: caseNumber,
                inline: true
              },
              {
                name: "Total Warnings",
                value: String(userWarnings.length),
                inline: true
              }
            )
        ]
      });
    } catch {
      // User has DMs disabled
    }

    return;
  }

  // ===================================================
  // /KICK
  // ===================================================

  if (command === "kick") {
    const target = interaction.options.getMember("user");
    const reason =
      interaction.options.getString("reason") ||
      "No reason provided";

    if (!target) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "User Not Found",
            "I couldn't find that member."
          )
        ],
        ephemeral: true
      });
    }

    if (!canModerate(member, target)) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Cannot Kick User",
            "You cannot kick yourself, the server owner, or a member with an equal/higher role."
          )
        ],
        ephemeral: true
      });
    }

    if (!botCanModerate(interaction.guild, target)) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Role Hierarchy",
            "My role must be higher than the target user's highest role."
          )
        ],
        ephemeral: true
      });
    }

    if (
      !interaction.guild.members.me.permissions.has(
        PermissionsBitField.Flags.KickMembers
      )
    ) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Missing Permission",
            "I need the **Kick Members** permission."
          )
        ],
        ephemeral: true
      });
    }

    const caseNumber = getCaseNumber();

    const embed = moderationEmbed({
      title: "👢 Member Kicked",
      description: `${target} has been kicked from the server.`,
      target,
      moderator: interaction.user,
      reason,
      caseNumber,
      color: COLORS.danger
    });

    try {
      await target.send({
        embeds: [
          baseEmbed(COLORS.danger)
            .setTitle("👢 You have been kicked")
            .setDescription(
              `You were kicked from **${interaction.guild.name}**.`
            )
            .addFields(
              {
                name: "Reason",
                value: reason
              },
              {
                name: "Case",
                value: caseNumber
              }
            )
        ]
      });
    } catch {
      // DMs disabled
    }

    await target.kick(reason);

    await interaction.reply({
      embeds: [embed]
    });

    await sendLog(interaction.guild, embed);

    return;
  }

  // ===================================================
  // /BAN
  // ===================================================

  if (command === "ban") {
    const target = interaction.options.getMember("user");
    const reason =
      interaction.options.getString("reason") ||
      "No reason provided";

    if (!target) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "User Not Found",
            "I couldn't find that member."
          )
        ],
        ephemeral: true
      });
    }

    if (!canModerate(member, target)) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Cannot Ban User",
            "You cannot ban yourself, the server owner, or a member with an equal/higher role."
          )
        ],
        ephemeral: true
      });
    }

    if (!botCanModerate(interaction.guild, target)) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Role Hierarchy",
            "My role must be higher than the target user's highest role."
          )
        ],
        ephemeral: true
      });
    }

    if (
      !interaction.guild.members.me.permissions.has(
        PermissionsBitField.Flags.BanMembers
      )
    ) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Missing Permission",
            "I need the **Ban Members** permission."
          )
        ],
        ephemeral: true
      });
    }

    const caseNumber = getCaseNumber();

    const embed = moderationEmbed({
      title: "🔨 Member Banned",
      description: `${target} has been banned from the server.`,
      target,
      moderator: interaction.user,
      reason,
      caseNumber,
      color: COLORS.danger
    });

    try {
      await target.send({
        embeds: [
          baseEmbed(COLORS.danger)
            .setTitle("🔨 You have been banned")
            .setDescription(
              `You were banned from **${interaction.guild.name}**.`
            )
            .addFields(
              {
                name: "Reason",
                value: reason
              },
              {
                name: "Case",
                value: caseNumber
              }
            )
        ]
      });
    } catch {
      // DMs disabled
    }

    await target.ban({
      reason
    });

    await interaction.reply({
      embeds: [embed]
    });

    await sendLog(interaction.guild, embed);

    return;
  }

  // ===================================================
  // /MUTE
  // ===================================================

  if (command === "mute") {
    const target = interaction.options.getMember("user");
    const durationInput =
      interaction.options.getString("duration");

    const reason =
      interaction.options.getString("reason") ||
      "No reason provided";

    const duration = parseDuration(durationInput);

    if (!target) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "User Not Found",
            "I couldn't find that member."
          )
        ],
        ephemeral: true
      });
    }

    if (!duration) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Invalid Duration",
            "Use a duration like `10m`, `1h`, `1d`, or `1w`."
          )
        ],
        ephemeral: true
      });
    }

    if (duration > 28 * 24 * 60 * 60 * 1000) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Duration Too Long",
            "Discord allows a maximum timeout of **28 days**."
          )
        ],
        ephemeral: true
      });
    }

    if (!canModerate(member, target)) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Cannot Mute User",
            "You cannot mute yourself, the server owner, or a member with an equal/higher role."
          )
        ],
        ephemeral: true
      });
    }

    if (!botCanModerate(interaction.guild, target)) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Role Hierarchy",
            "My role must be higher than the target user's highest role."
          )
        ],
        ephemeral: true
      });
    }

    if (
      !interaction.guild.members.me.permissions.has(
        PermissionsBitField.Flags.ModerateMembers
      )
    ) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Missing Permission",
            "I need the **Moderate Members** permission."
          )
        ],
        ephemeral: true
      });
    }

    const caseNumber = getCaseNumber();

    await target.timeout(
      duration,
      reason
    );

    const embed = moderationEmbed({
      title: "🔇 Member Muted",
      description: `${target} has been timed out.`,
      target,
      moderator: interaction.user,
      reason,
      caseNumber,
      color: COLORS.warning
    }).addFields({
      name: "Duration",
      value: durationInput,
      inline: true
    });

    await interaction.reply({
      embeds: [embed]
    });

    await sendLog(interaction.guild, embed);

    try {
      await target.send({
        embeds: [
          baseEmbed(COLORS.warning)
            .setTitle("🔇 You have been muted")
            .setDescription(
              `You were timed out in **${interaction.guild.name}**.`
            )
            .addFields(
              {
                name: "Duration",
                value: durationInput,
                inline: true
              },
              {
                name: "Reason",
                value: reason,
                inline: false
              },
              {
                name: "Case",
                value: caseNumber,
                inline: true
              }
            )
        ]
      });
    } catch {
      // DMs disabled
    }

    return;
  }

  // ===================================================
  // /JOINDM
  // ===================================================

  if (command === "joindm") {
    const message =
      interaction.options.getString("message");

    joinDM[interaction.guild.id] = {
      enabled: true,
      message
    };

    saveJoinDM();

    const embed = baseEmbed(COLORS.success)
      .setTitle("👋 Join DM Enabled")
      .setDescription(
        "Automatic welcome DMs are now enabled."
      )
      .addFields({
        name: "Message",
        value: message
      });

    return interaction.reply({
      embeds: [embed]
    });
  }

  // ===================================================
  // /EDITJOINDM
  // ===================================================

  if (command === "editjoindm") {
    const message =
      interaction.options.getString("message");

    if (
      !joinDM[interaction.guild.id] ||
      !joinDM[interaction.guild.id].enabled
    ) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Join DM Not Enabled",
            "Use `/joindm` first."
          )
        ],
        ephemeral: true
      });
    }

    joinDM[interaction.guild.id].message = message;

    saveJoinDM();

    const embed = baseEmbed(COLORS.success)
      .setTitle("✏️ Join DM Updated")
      .setDescription(
        "The automatic welcome DM has been updated."
      )
      .addFields({
        name: "New Message",
        value: message
      });

    return interaction.reply({
      embeds: [embed]
    });
  }

  // ===================================================
  // /STOPJOINDM
  // ===================================================

  if (command === "stopjoindm") {
    if (!joinDM[interaction.guild.id]) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Join DM Not Enabled",
            "There is no active join DM system."
          )
        ],
        ephemeral: true
      });
    }

    joinDM[interaction.guild.id].enabled = false;

    saveJoinDM();

    return interaction.reply({
      embeds: [
        successEmbed(
          "👋 Join DM Disabled",
          "Automatic welcome DMs have been disabled."
        )
      ]
    });
  }
});

// =====================================================
// PREFIX COMMANDS
// =====================================================

client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  if (!message.content.startsWith(PREFIX)) {
    return;
  }

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);

  const command = args.shift()?.toLowerCase();

  if (!command) return;

  // ===================================================
  // PREFIX PERMISSION
  // ===================================================

  const moderationCommands = [
    "warn",
    "kick",
    "ban",
    "mute",
    "joindm",
    "editjoindm",
    "stopjoindm"
  ];

  if (moderationCommands.includes(command)) {
    if (!isModerator(message.member)) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Access Denied",
            "You need **Administrator** permission or be the **Server Owner** to use this command."
          )
        ]
      });
    }
  }

  // ===================================================
  // ?COMMANDS
  // ===================================================

  if (command === "commands") {
    if (!isModerator(message.member)) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Access Denied",
            "Only **Server Owners and Administrators** can use this command."
          )
        ]
      });
    }

    const embed = baseEmbed(COLORS.info)
      .setTitle("📖 Mog Moderation Commands")
      .setDescription(
        "Here are all the commands currently available."
      )
      .addFields(
        {
          name: "🛡️ Moderation",
          value:
            "`/warn @user [reason]`\n" +
            "`/kick @user [reason]`\n" +
            "`/ban @user [reason]`\n" +
            "`/mute @user <duration> [reason]`"
        },
        {
          name: "👋 Join DM",
          value:
            "`/joindm <message>`\n" +
            "`/editjoindm <message>`\n" +
            "`/stopjoindm`"
        },
        {
          name: "⌨️ Prefix Commands",
          value:
            "`?warn @user [reason]`\n" +
            "`?kick @user [reason]`\n" +
            "`?ban @user [reason]`\n" +
            "`?mute @user <duration> [reason]`\n" +
            "`?joindm <message>`\n" +
            "`?editjoindm <message>`\n" +
            "`?stopjoindm`"
        },
        {
          name: "📌 Join DM Variables",
          value:
            "`{user}` • Mention the member\n" +
            "`{username}` • Their username\n" +
            "`{server}` • Server name\n" +
            "`{membercount}` • Current member count"
        }
      )
      .setFooter({
        text: "Mog Moderation • Owner/Admin Command"
      });

    return message.reply({
      embeds: [embed]
    });
  }

  // ===================================================
  // ?WARN
  // ===================================================

  if (command === "warn") {
    const target =
      message.mentions.members.first();

    const reason =
      args.slice(1).join(" ") ||
      "No reason provided";

    if (!target) {
      return message.reply({
        embeds: [
          errorEmbed(
            "User Not Found",
            "Mention a member to warn.\n\nExample: `?warn @user spam`"
          )
        ]
      });
    }

    if (!canModerate(message.member, target)) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Cannot Warn User",
            "You cannot warn yourself, the server owner, or a member with an equal/higher role."
          )
        ]
      });
    }

    const userWarnings = getUserWarnings(
      message.guild.id,
      target.id
    );

    const caseNumber = getCaseNumber();

    userWarnings.push({
      case: caseNumber,
      reason,
      moderator: message.author.id,
      timestamp: new Date().toISOString()
    });

    saveWarnings();

    const embed = moderationEmbed({
      title: "⚠️ Member Warned",
      description: `${target} has been warned.`,
      target,
      moderator: message.author,
      reason,
      caseNumber,
      color: COLORS.warning
    }).addFields({
      name: "Total Warnings",
      value: `**${userWarnings.length}**`,
      inline: true
    });

    await message.reply({
      embeds: [embed]
    });

    await sendLog(message.guild, embed);

    return;
  }

  // ===================================================
  // ?KICK
  // ===================================================

  if (command === "kick") {
    const target =
      message.mentions.members.first();

    const reason =
      args.slice(1).join(" ") ||
      "No reason provided";

    if (!target) {
      return message.reply({
        embeds: [
          errorEmbed(
            "User Not Found",
            "Mention a member to kick."
          )
        ]
      });
    }

    if (!canModerate(message.member, target)) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Cannot Kick User",
            "You cannot kick yourself, the server owner, or a member with an equal/higher role."
          )
        ]
      });
    }

    if (!botCanModerate(message.guild, target)) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Role Hierarchy",
            "My role must be higher than the target user's highest role."
          )
        ]
      });
    }

    if (
      !message.guild.members.me.permissions.has(
        PermissionsBitField.Flags.KickMembers
      )
    ) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Missing Permission",
            "I need the **Kick Members** permission."
          )
        ]
      });
    }

    const caseNumber = getCaseNumber();

    const embed = moderationEmbed({
      title: "👢 Member Kicked",
      description: `${target} has been kicked from the server.`,
      target,
      moderator: message.author,
      reason,
      caseNumber,
      color: COLORS.danger
    });

    await target.kick(reason);

    await message.reply({
      embeds: [embed]
    });

    await sendLog(message.guild, embed);

    return;
  }

  // ===================================================
  // ?BAN
  // ===================================================

  if (command === "ban") {
    const target =
      message.mentions.members.first();

    const reason =
      args.slice(1).join(" ") ||
      "No reason provided";

    if (!target) {
      return message.reply({
        embeds: [
          errorEmbed(
            "User Not Found",
            "Mention a member to ban."
          )
        ]
      });
    }

    if (!canModerate(message.member, target)) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Cannot Ban User",
            "You cannot ban yourself, the server owner, or a member with an equal/higher role."
          )
        ]
      });
    }

    if (!botCanModerate(message.guild, target)) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Role Hierarchy",
            "My role must be higher than the target user's highest role."
          )
        ]
      });
    }

    if (
      !message.guild.members.me.permissions.has(
        PermissionsBitField.Flags.BanMembers
      )
    ) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Missing Permission",
            "I need the **Ban Members** permission."
          )
        ]
      });
    }

    const caseNumber = getCaseNumber();

    const embed = moderationEmbed({
      title: "🔨 Member Banned",
      description: `${target} has been banned from the server.`,
      target,
      moderator: message.author,
      reason,
      caseNumber,
      color: COLORS.danger
    });

    await target.ban({
      reason
    });

    await message.reply({
      embeds: [embed]
    });

    await sendLog(message.guild, embed);

    return;
  }

  // ===================================================
  // ?MUTE
  // ===================================================

  if (command === "mute") {
    const target =
      message.mentions.members.first();

    const durationInput = args[1];

    const reason =
      args.slice(2).join(" ") ||
      "No reason provided";

    if (!target) {
      return message.reply({
        embeds: [
          errorEmbed(
            "User Not Found",
            "Mention a member to mute."
          )
        ]
      });
    }

    if (!durationInput) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Missing Duration",
            "Example: `?mute @user 10m spam`"
          )
        ]
      });
    }

    const duration = parseDuration(durationInput);

    if (!duration) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Invalid Duration",
            "Use `10s`, `10m`, `1h`, `1d`, or `1w`."
          )
        ]
      });
    }

    if (duration > 28 * 24 * 60 * 60 * 1000) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Duration Too Long",
            "Discord allows a maximum timeout of **28 days**."
          )
        ]
      });
    }

    if (!canModerate(message.member, target)) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Cannot Mute User",
            "You cannot mute yourself, the server owner, or a member with an equal/higher role."
          )
        ]
      });
    }

    if (!botCanModerate(message.guild, target)) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Role Hierarchy",
            "My role must be higher than the target user's highest role."
          )
        ]
      });
    }

    if (
      !message.guild.members.me.permissions.has(
        PermissionsBitField.Flags.ModerateMembers
      )
    ) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Missing Permission",
            "I need the **Moderate Members** permission."
          )
        ]
      });
    }

    const caseNumber = getCaseNumber();

    await target.timeout(
      duration,
      reason
    );

    const embed = moderationEmbed({
      title: "🔇 Member Muted",
      description: `${target} has been timed out.`,
      target,
      moderator: message.author,
      reason,
      caseNumber,
      color: COLORS.warning
    }).addFields({
      name: "Duration",
      value: durationInput,
      inline: true
    });

    await message.reply({
      embeds: [embed]
    });

    await sendLog(message.guild, embed);

    return;
  }

  // ===================================================
  // ?JOINDM
  // ===================================================

  if (command === "joindm") {
    const messageText = args.join(" ");

    if (!messageText) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Missing Message",
            "Example:\n`?joindm Welcome {user} to {server}!`"
          )
        ]
      });
    }

    joinDM[message.guild.id] = {
      enabled: true,
      message: messageText
    };

    saveJoinDM();

    return message.reply({
      embeds: [
        successEmbed(
          "👋 Join DM Enabled",
          "Automatic welcome DMs are now enabled."
        ).addFields({
          name: "Message",
          value: messageText
        })
      ]
    });
  }

  // ===================================================
  // ?EDITJOINDM
  // ===================================================

  if (command === "editjoindm") {
    const messageText = args.join(" ");

    if (!messageText) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Missing Message",
            "Example:\n`?editjoindm Welcome {user}!`"
          )
        ]
      });
    }

    if (
      !joinDM[message.guild.id] ||
      !joinDM[message.guild.id].enabled
    ) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Join DM Not Enabled",
            "Use `?joindm` first."
          )
        ]
      });
    }

    joinDM[message.guild.id].message =
      messageText;

    saveJoinDM();

    return message.reply({
      embeds: [
        successEmbed(
          "✏️ Join DM Updated",
          "The automatic welcome DM has been updated."
        ).addFields({
          name: "New Message",
          value: messageText
        })
      ]
    });
  }

  // ===================================================
  // ?STOPJOINDM
  // ===================================================

  if (command === "stopjoindm") {
    if (!joinDM[message.guild.id]) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Join DM Not Enabled",
            "There is no active join DM system."
          )
        ]
      });
    }

    joinDM[message.guild.id].enabled = false;

    saveJoinDM();

    return message.reply({
      embeds: [
        successEmbed(
          "👋 Join DM Disabled",
          "Automatic welcome DMs have been disabled."
        )
      ]
    });
  }
});

// =====================================================
// EXPRESS SERVER
// =====================================================

const app = express();

app.get("/", (req, res) => {
  res.send("Mog Moderation is online.");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

// =====================================================
// LOGIN
// =====================================================

if (!process.env.DISCORD_TOKEN) {
  console.error(
    "DISCORD_TOKEN is missing from environment variables."
  );
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
