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

function moderationEmbed({
  title,
  description,
  target,
  moderator,
  reason,
  caseNumber,
  color
}) {
  return baseEmbed(color)
    .setTitle(title)
    .setDescription(description)
    .setThumbnail(target.displayAvatarURL())
    .addFields(
      {
        name: "User",
        value: `${target} \`${target.user.tag}\``,
        inline: true
      },
      {
        name: "Moderator",
        value: `${moderator}`,
        inline: true
      },
      {
        name: "Case",
        value: caseNumber,
        inline: true
      },
      {
        name: "Reason",
        value: reason,
        inline: false
      }
    );
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

  if (executor.id === target.id) {
    return false;
  }

  if (executor.id === executor.guild.ownerId) {
    return true;
  }

  if (target.id === target.guild.ownerId) {
    return false;
  }

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

function botCanManageRole(guild, role) {
  const botMember = guild.members.me;

  if (!botMember || !role) {
    return false;
  }

  return role.position < botMember.roles.highest.position;
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
    name: "unwarn",
    description: "Remove a member's most recent warning",
    options: [
      {
        name: "user",
        description: "The member whose latest warning should be removed",
        type: 6,
        required: true
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
    name: "unban",
    description: "Unban a user by their Discord ID",
    options: [
      {
        name: "userid",
        description: "The Discord ID of the banned user",
        type: 3,
        required: true
      },
      {
        name: "reason",
        description: "Reason for the unban",
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
    name: "unmute",
    description: "Remove a member's timeout",
    options: [
      {
        name: "user",
        description: "The member to unmute",
        type: 6,
        required: true
      },
      {
        name: "reason",
        description: "Reason for the unmute",
        type: 3,
        required: false
      }
    ]
  },

  {
    name: "role",
    description: "Give a role to a member",
    options: [
      {
        name: "user",
        description: "The member to give the role to",
        type: 6,
        required: true
      },
      {
        name: "role",
        description: "The role to give",
        type: 8,
        required: true
      }
    ]
  },

  {
    name: "unrole",
    description: "Remove a role from a member",
    options: [
      {
        name: "user",
        description: "The member to remove the role from",
        type: 6,
        required: true
      },
      {
        name: "role",
        description: "The role to remove",
        type: 8,
        required: true
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
      console.error(
        "CLIENT_ID is missing from environment variables."
      );
      return;
    }

    await rest.put(
      Routes.applicationCommands(
        process.env.CLIENT_ID
      ),
      {
        body: slashCommands
      }
    );

    console.log("Global slash commands registered.");
  } catch (error) {
    console.error(
      "Error registering global slash commands:",
      error
    );
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
  // /COMMANDS
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
            "`/unwarn @user`\n" +
            "`/kick @user [reason]`\n" +
            "`/ban @user [reason]`\n" +
            "`/unban <userid> [reason]`\n" +
            "`/mute @user <duration> [reason]`\n" +
            "`/unmute @user [reason]`\n" +
            "`/role @user @role`\n" +
            "`/unrole @user @role`"
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
            "`?unwarn @user`\n" +
            "`?kick @user [reason]`\n" +
            "`?ban @user [reason]`\n" +
            "`?unban <userid> [reason]`\n" +
            "`?mute @user <duration> [reason]`\n" +
            "`?unmute @user [reason]`\n" +
            "`?role @user @role`\n" +
            "`?unrole @user @role`\n" +
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
      "unwarn",
      "kick",
      "ban",
      "unban",
      "mute",
      "unmute",
      "role",
      "unrole",
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
  // /UNWARN
  // ===================================================

  if (command === "unwarn") {
    const target = interaction.options.getMember("user");

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
            "Cannot Remove Warning",
            "You cannot remove a warning from yourself, the server owner, or a member with an equal/higher role."
          )
        ],
        ephemeral: true
      });
    }

    const userWarnings = getUserWarnings(
      interaction.guild.id,
      target.id
    );

    if (userWarnings.length === 0) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "No Warnings",
            `${target} does not have any warnings to remove.`
          )
        ],
        ephemeral: true
      });
    }

    const removedWarning =
      userWarnings.pop();

    saveWarnings();

    const caseNumber = getCaseNumber();

    const embed = moderationEmbed({
      title: "↩️ Warning Removed",
      description: `The most recent warning for ${target} has been removed.`,
      target,
      moderator: interaction.user,
      reason: `Removed warning ${removedWarning.case}`,
      caseNumber,
      color: COLORS.success
    }).addFields({
      name: "Warnings Remaining",
      value: `**${userWarnings.length}**`,
      inline: true
    });

    await interaction.reply({
      embeds: [embed]
    });

    await sendLog(interaction.guild, embed);

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
  // /UNBAN
  // ===================================================

  if (command === "unban") {
    const userId =
      interaction.options.getString("userid");

    const reason =
      interaction.options.getString("reason") ||
      "No reason provided";

    if (!/^\d{17,20}$/.test(userId)) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Invalid User ID",
            "Please provide a valid Discord user ID."
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

    let bannedUser;

    try {
      bannedUser =
        await interaction.guild.bans.fetch(userId);
    } catch {
      bannedUser = null;
    }

    if (!bannedUser) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "User Not Banned",
            "That user is not currently banned from this server."
          )
        ],
        ephemeral: true
      });
    }

    const caseNumber = getCaseNumber();

    const embed = baseEmbed(COLORS.success)
      .setTitle("↩️ Member Unbanned")
      .setDescription(
        `<@${userId}> has been unbanned from the server.`
      )
      .setThumbnail(
        bannedUser.user.displayAvatarURL()
      )
      .addFields(
        {
          name: "User",
          value: `${bannedUser.user} \`${bannedUser.user.tag}\``,
          inline: true
        },
        {
          name: "Moderator",
          value: `${interaction.user}`,
          inline: true
        },
        {
          name: "Case",
          value: caseNumber,
          inline: true
        },
        {
          name: "Reason",
          value: reason,
          inline: false
        }
      )
      .setTimestamp()
      .setFooter({
        text: "Mog Moderation"
      });

    try {
      await interaction.guild.members.unban(
        userId,
        reason
      );
    } catch (error) {
      console.error("Unban error:", error);

      return interaction.reply({
        embeds: [
          errorEmbed(
            "Unban Failed",
            "I couldn't unban that user. Check my permissions and try again."
          )
        ],
        ephemeral: true
      });
    }

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
  // /UNMUTE
  // ===================================================

  if (command === "unmute") {
    const target =
      interaction.options.getMember("user");

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
            "Cannot Unmute User",
            "You cannot unmute yourself, the server owner, or a member with an equal/higher role."
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

    if (!target.communicationDisabledUntilTimestamp) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "User Not Muted",
            `${target} is not currently timed out.`
          )
        ],
        ephemeral: true
      });
    }

    const caseNumber = getCaseNumber();

    try {
      await target.timeout(null, reason);
    } catch (error) {
      console.error("Unmute error:", error);

      return interaction.reply({
        embeds: [
          errorEmbed(
            "Unmute Failed",
            "I couldn't remove the timeout from that member."
          )
        ],
        ephemeral: true
      });
    }

    const embed = moderationEmbed({
      title: "🔊 Member Unmuted",
      description: `${target} is no longer timed out.`,
      target,
      moderator: interaction.user,
      reason,
      caseNumber,
      color: COLORS.success
    });

    await interaction.reply({
      embeds: [embed]
    });

    await sendLog(interaction.guild, embed);

    return;
  }

  // ===================================================
  // /ROLE
  // ===================================================

  if (command === "role") {
    const target =
      interaction.options.getMember("user");

    const role =
      interaction.options.getRole("role");

    if (!target || !role) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Missing Information",
            "Please provide both a member and a role."
          )
        ],
        ephemeral: true
      });
    }

    if (!canModerate(member, target)) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Cannot Manage User",
            "You cannot manage yourself, the server owner, or a member with an equal/higher role."
          )
        ],
        ephemeral: true
      });
    }

    if (role.id === interaction.guild.id) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Invalid Role",
            "The `@everyone` role cannot be assigned."
          )
        ],
        ephemeral: true
      });
    }

    if (role.managed) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Managed Role",
            "I cannot manually assign an integration/bot managed role."
          )
        ],
        ephemeral: true
      });
    }

    if (
      !member.guild.members.me.permissions.has(
        PermissionsBitField.Flags.ManageRoles
      )
    ) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Missing Permission",
            "I need the **Manage Roles** permission."
          )
        ],
        ephemeral: true
      });
    }

    if (!botCanManageRole(interaction.guild, role)) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Role Hierarchy",
            "My highest role must be higher than the role you are trying to give."
          )
        ],
        ephemeral: true
      });
    }

    if (
      member.id !== interaction.guild.ownerId &&
      role.position >= member.roles.highest.position
    ) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Role Hierarchy",
            "You cannot give a role that is equal to or higher than your highest role."
          )
        ],
        ephemeral: true
      });
    }

    if (target.roles.cache.has(role.id)) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Role Already Assigned",
            `${target} already has ${role}.`
          )
        ],
        ephemeral: true
      });
    }

    const caseNumber = getCaseNumber();

    try {
      await target.roles.add(
        role,
        `Role added by ${interaction.user.tag}`
      );
    } catch (error) {
      console.error("Role add error:", error);

      return interaction.reply({
        embeds: [
          errorEmbed(
            "Role Failed",
            "I couldn't give that role to the member."
          )
        ],
        ephemeral: true
      });
    }

    const embed = moderationEmbed({
      title: "🎭 Role Added",
      description: `${role} has been added to ${target}.`,
      target,
      moderator: interaction.user,
      reason: `Added role: ${role.name}`,
      caseNumber,
      color: COLORS.success
    });

    await interaction.reply({
      embeds: [embed]
    });

    await sendLog(interaction.guild, embed);

    return;
  }

  // ===================================================
  // /UNROLE
  // ===================================================

  if (command === "unrole") {
    const target =
      interaction.options.getMember("user");

    const role =
      interaction.options.getRole("role");

    if (!target || !role) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Missing Information",
            "Please provide both a member and a role."
          )
        ],
        ephemeral: true
      });
    }

    if (!canModerate(member, target)) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Cannot Manage User",
            "You cannot manage yourself, the server owner, or a member with an equal/higher role."
          )
        ],
        ephemeral: true
      });
    }

    if (role.id === interaction.guild.id) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Invalid Role",
            "The `@everyone` role cannot be removed."
          )
        ],
        ephemeral: true
      });
    }

    if (role.managed) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Managed Role",
            "I cannot manually remove an integration/bot managed role."
          )
        ],
        ephemeral: true
      });
    }

    if (
      !member.guild.members.me.permissions.has(
        PermissionsBitField.Flags.ManageRoles
      )
    ) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Missing Permission",
            "I need the **Manage Roles** permission."
          )
        ],
        ephemeral: true
      });
    }

    if (!botCanManageRole(interaction.guild, role)) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Role Hierarchy",
            "My highest role must be higher than the role you are trying to remove."
          )
        ],
        ephemeral: true
      });
    }

    if (
      member.id !== interaction.guild.ownerId &&
      role.position >= member.roles.highest.position
    ) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Role Hierarchy",
            "You cannot remove a role that is equal to or higher than your highest role."
          )
        ],
        ephemeral: true
      });
    }

    if (!target.roles.cache.has(role.id)) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Role Not Found",
            `${target} does not have ${role}.`
          )
        ],
        ephemeral: true
      });
    }

    const caseNumber = getCaseNumber();

    try {
      await target.roles.remove(
        role,
        `Role removed by ${interaction.user.tag}`
      );
    } catch (error) {
      console.error("Role remove error:", error);

      return interaction.reply({
        embeds: [
          errorEmbed(
            "Role Removal Failed",
            "I couldn't remove that role from the member."
          )
        ],
        ephemeral: true
      });
    }

    const embed = moderationEmbed({
      title: "🎭 Role Removed",
      description: `${role} has been removed from ${target}.`,
      target,
      moderator: interaction.user,
      reason: `Removed role: ${role.name}`,
      caseNumber,
      color: COLORS.success
    });

    await interaction.reply({
      embeds: [embed]
    });

    await sendLog(interaction.guild, embed);

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

  const args = message.content
    .slice(PREFIX.length)
    .trim()
    .split(/\s+/);

  const command = args.shift()?.toLowerCase();

  if (!command) return;

  // ===================================================
  // PREFIX PERMISSION
  // ===================================================

  const moderationCommands = [
    "warn",
    "unwarn",
    "kick",
    "ban",
    "unban",
    "mute",
    "unmute",
    "role",
    "unrole",
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
            "`/unwarn @user`\n" +
            "`/kick @user [reason]`\n" +
            "`/ban @user [reason]`\n" +
            "`/unban <userid> [reason]`\n" +
            "`/mute @user <duration> [reason]`\n" +
            "`/unmute @user [reason]`\n" +
            "`/role @user @role`\n" +
            "`/unrole @user @role`"
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
            "`?unwarn @user`\n" +
            "`?kick @user [reason]`\n" +
            "`?ban @user [reason]`\n" +
            "`?unban <userid> [reason]`\n" +
            "`?mute @user <duration> [reason]`\n" +
            "`?unmute @user [reason]`\n" +
            "`?role @user @role`\n" +
            "`?unrole @user @role`\n" +
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
  // ?UNWARN
  // ===================================================

  if (command === "unwarn") {
    const target =
      message.mentions.members.first();

    if (!target) {
      return message.reply({
        embeds: [
          errorEmbed(
            "User Not Found",
            "Mention a member to remove their latest warning.\n\nExample: `?unwarn @user`"
          )
        ]
      });
    }

    if (!canModerate(message.member, target)) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Cannot Remove Warning",
            "You cannot remove a warning from yourself, the server owner, or a member with an equal/higher role."
          )
        ]
      });
    }

    const userWarnings = getUserWarnings(
      message.guild.id,
      target.id
    );

    if (userWarnings.length === 0) {
      return message.reply({
        embeds: [
          errorEmbed(
            "No Warnings",
            `${target} does not have any warnings to remove.`
          )
        ]
      });
    }

    const removedWarning =
      userWarnings.pop();

    saveWarnings();

    const caseNumber = getCaseNumber();

    const embed = moderationEmbed({
      title: "↩️ Warning Removed",
      description: `The most recent warning for ${target} has been removed.`,
      target,
      moderator: message.author,
      reason: `Removed warning ${removedWarning.case}`,
      caseNumber,
      color: COLORS.success
    }).addFields({
      name: "Warnings Remaining",
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
  // ?UNBAN
  // ===================================================

  if (command === "unban") {
    const rawId = args[0];

    if (!rawId) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Missing User ID",
            "Use the user's Discord ID.\n\nExample: `?unban 123456789012345678`"
          )
        ]
      });
    }

    const userIdMatch =
      rawId.match(/\d{17,20}/);

    const userId =
      userIdMatch ? userIdMatch[0] : null;

    if (!userId) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Invalid User ID",
            "Please provide a valid Discord user ID."
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

    let bannedUser;

    try {
      bannedUser =
        await message.guild.bans.fetch(userId);
    } catch {
      bannedUser = null;
    }

    if (!bannedUser) {
      return message.reply({
        embeds: [
          errorEmbed(
            "User Not Banned",
            "That user is not currently banned from this server."
          )
        ]
      });
    }

    const reason =
      args.slice(1).join(" ") ||
      "No reason provided";

    const caseNumber = getCaseNumber();

    const embed = baseEmbed(COLORS.success)
      .setTitle("↩️ Member Unbanned")
      .setDescription(
        `<@${userId}> has been unbanned from the server.`
      )
      .setThumbnail(
        bannedUser.user.displayAvatarURL()
      )
      .addFields(
        {
          name: "User",
          value: `${bannedUser.user} \`${bannedUser.user.tag}\``,
          inline: true
        },
        {
          name: "Moderator",
          value: `${message.author}`,
          inline: true
        },
        {
          name: "Case",
          value: caseNumber,
          inline: true
        },
        {
          name: "Reason",
          value: reason,
          inline: false
        }
      )
      .setTimestamp()
      .setFooter({
        text: "Mog Moderation"
      });

    try {
      await message.guild.members.unban(
        userId,
        reason
      );
    } catch (error) {
      console.error("Unban error:", error);

      return message.reply({
        embeds: [
          errorEmbed(
            "Unban Failed",
            "I couldn't unban that user. Check my permissions and try again."
          )
        ]
      });
    }

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
  // ?UNMUTE
  // ===================================================

  if (command === "unmute") {
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
            "Mention a member to unmute.\n\nExample: `?unmute @user`"
          )
        ]
      });
    }

    if (!canModerate(message.member, target)) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Cannot Unmute User",
            "You cannot unmute yourself, the server owner, or a member with an equal/higher role."
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

    if (!target.communicationDisabledUntilTimestamp) {
      return message.reply({
        embeds: [
          errorEmbed(
            "User Not Muted",
            `${target} is not currently timed out.`
          )
        ]
      });
    }

    const caseNumber = getCaseNumber();

    try {
      await target.timeout(null, reason);
    } catch (error) {
      console.error("Unmute error:", error);

      return message.reply({
        embeds: [
          errorEmbed(
            "Unmute Failed",
            "I couldn't remove the timeout from that member."
          )
        ]
      });
    }

    const embed = moderationEmbed({
      title: "🔊 Member Unmuted",
      description: `${target} is no longer timed out.`,
      target,
      moderator: message.author,
      reason,
      caseNumber,
      color: COLORS.success
    });

    await message.reply({
      embeds: [embed]
    });

    await sendLog(message.guild, embed);

    return;
  }

  // ===================================================
  // ?ROLE
  // ===================================================

  if (command === "role") {
    const target =
      message.mentions.members.first();

    const role =
      message.mentions.roles.first();

    if (!target || !role) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Missing Information",
            "Mention a member and a role.\n\nExample: `?role @user @role`"
          )
        ]
      });
    }

    if (!canModerate(message.member, target)) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Cannot Manage User",
            "You cannot manage yourself, the server owner, or a member with an equal/higher role."
          )
        ]
      });
    }

    if (role.id === message.guild.id) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Invalid Role",
            "The `@everyone` role cannot be assigned."
          )
        ]
      });
    }

    if (role.managed) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Managed Role",
            "I cannot manually assign an integration/bot managed role."
          )
        ]
      });
    }

    if (
      !message.guild.members.me.permissions.has(
        PermissionsBitField.Flags.ManageRoles
      )
    ) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Missing Permission",
            "I need the **Manage Roles** permission."
          )
        ]
      });
    }

    if (!botCanManageRole(message.guild, role)) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Role Hierarchy",
            "My highest role must be higher than the role you are trying to give."
          )
        ]
      });
    }

    if (
      message.member.id !== message.guild.ownerId &&
      role.position >= message.member.roles.highest.position
    ) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Role Hierarchy",
            "You cannot give a role that is equal to or higher than your highest role."
          )
        ]
      });
    }

    if (target.roles.cache.has(role.id)) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Role Already Assigned",
            `${target} already has ${role}.`
          )
        ]
      });
    }

    const caseNumber = getCaseNumber();

    try {
      await target.roles.add(
        role,
        `Role added by ${message.author.tag}`
      );
    } catch (error) {
      console.error("Role add error:", error);

      return message.reply({
        embeds: [
          errorEmbed(
            "Role Failed",
            "I couldn't give that role to the member."
          )
        ]
      });
    }

    const embed = moderationEmbed({
      title: "🎭 Role Added",
      description: `${role} has been added to ${target}.`,
      target,
      moderator: message.author,
      reason: `Added role: ${role.name}`,
      caseNumber,
      color: COLORS.success
    });

    await message.reply({
      embeds: [embed]
    });

    await sendLog(message.guild, embed);

    return;
  }

  // ===================================================
  // ?UNROLE
  // ===================================================

  if (command === "unrole") {
    const target =
      message.mentions.members.first();

    const role =
      message.mentions.roles.first();

    if (!target || !role) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Missing Information",
            "Mention a member and a role.\n\nExample: `?unrole @user @role`"
          )
        ]
      });
    }

    if (!canModerate(message.member, target)) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Cannot Manage User",
            "You cannot manage yourself, the server owner, or a member with an equal/higher role."
          )
        ]
      });
    }

    if (role.id === message.guild.id) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Invalid Role",
            "The `@everyone` role cannot be removed."
          )
        ]
      });
    }

    if (role.managed) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Managed Role",
            "I cannot manually remove an integration/bot managed role."
          )
        ]
      });
    }

    if (
      !message.guild.members.me.permissions.has(
        PermissionsBitField.Flags.ManageRoles
      )
    ) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Missing Permission",
            "I need the **Manage Roles** permission."
          )
        ]
      });
    }

    if (!botCanManageRole(message.guild, role)) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Role Hierarchy",
            "My highest role must be higher than the role you are trying to remove."
          )
        ]
      });
    }

    if (
      message.member.id !== message.guild.ownerId &&
      role.position >= message.member.roles.highest.position
    ) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Role Hierarchy",
            "You cannot remove a role that is equal to or higher than your highest role."
          )
        ]
      });
    }

    if (!target.roles.cache.has(role.id)) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Role Not Found",
            `${target} does not have ${role}.`
          )
        ]
      });
    }

    const caseNumber = getCaseNumber();

    try {
      await target.roles.remove(
        role,
        `Role removed by ${message.author.tag}`
      );
    } catch (error) {
      console.error("Role remove error:", error);

      return message.reply({
        embeds: [
          errorEmbed(
            "Role Removal Failed",
            "I couldn't remove that role from the member."
          )
        ]
      });
    }

    const embed = moderationEmbed({
      title: "🎭 Role Removed",
      description: `${role} has been removed from ${target}.`,
      target,
      moderator: message.author,
      reason: `Removed role: ${role.name}`,
      caseNumber,
      color: COLORS.success
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
