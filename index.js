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

// =========================
// CONFIG
// =========================

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

// =========================
// WARNING STORAGE
// =========================

function loadWarnings() {
  try {
    if (!fs.existsSync(WARNINGS_FILE)) {
      fs.writeFileSync(WARNINGS_FILE, "{}");
      return {};
    }

    const data = fs.readFileSync(WARNINGS_FILE, "utf8");

    if (!data.trim()) return {};

    return JSON.parse(data);
  } catch (error) {
    console.error("Could not load warnings.json:", error);
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
    console.error("Could not save warnings:", error);
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

// =========================
// JOIN DM STORAGE
// =========================

function loadJoinDMs() {
  try {
    if (!fs.existsSync(JOINDM_FILE)) {
      fs.writeFileSync(JOINDM_FILE, "{}");
      return {};
    }

    const data = fs.readFileSync(JOINDM_FILE, "utf8");

    if (!data.trim()) return {};

    return JSON.parse(data);
  } catch (error) {
    console.error("Could not load joindm.json:", error);
    return {};
  }
}

let joinDMs = loadJoinDMs();

function saveJoinDMs() {
  try {
    fs.writeFileSync(
      JOINDM_FILE,
      JSON.stringify(joinDMs, null, 2)
    );
  } catch (error) {
    console.error("Could not save joindm.json:", error);
  }
}

function getJoinDMSettings(guildId) {
  if (!joinDMs[guildId]) {
    joinDMs[guildId] = {
      enabled: false,
      message: ""
    };
  }

  return joinDMs[guildId];
}

// =========================
// CASE NUMBERS
// =========================

let nextCase = 1;

function getCaseNumber() {
  const number = String(nextCase).padStart(4, "0");
  nextCase++;
  return "#" + number;
}

// =========================
// COLORS
// =========================

const COLORS = {
  success: 0x57F287,
  danger: 0xED4245,
  warning: 0xFEE75C,
  info: 0x5865F2,
  neutral: 0x2B2D31
};

// =========================
// EMBEDS
// =========================

function baseEmbed(color = COLORS.info) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTimestamp()
    .setFooter({
      text: "Mog Moderation"
    });

  if (client.user) {
    embed.setAuthor({
      name: "MOG MODERATION",
      iconURL: client.user.displayAvatarURL()
    });
  } else {
    embed.setAuthor({
      name: "MOG MODERATION"
    });
  }

  return embed;
}

function successEmbed(title, description, fields = []) {
  const embed = baseEmbed(COLORS.success)
    .setTitle(title)
    .setDescription(description);

  if (fields.length) {
    embed.addFields(fields);
  }

  return embed;
}

function errorEmbed(title, description) {
  return baseEmbed(COLORS.danger)
    .setTitle(title)
    .setDescription(description);
}

function infoEmbed(title, description, fields = []) {
  const embed = baseEmbed(COLORS.info)
    .setTitle(title)
    .setDescription(description);

  if (fields.length) {
    embed.addFields(fields);
  }

  return embed;
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
    .addFields(
      {
        name: "User",
        value: `${target}\n\`${target.id}\``,
        inline: true
      },
      {
        name: "Moderator",
        value: `${moderator}`,
        inline: true
      },
      {
        name: "Case",
        value: `\`${caseNumber}\``,
        inline: true
      },
      {
        name: "Reason",
        value: reason || "No reason provided",
        inline: false
      }
    )
    .setThumbnail(target.displayAvatarURL());
}

// =========================
// PERMISSION CHECKS
// =========================

function isAdmin(member) {
  if (!member) return false;

  return (
    member.id === member.guild.ownerId ||
    member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  );
}

function canModerate(executor, target) {
  if (!target) return false;

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

// =========================
// LOGGING
// =========================

async function sendLog(guild, embed) {
  try {
    let logChannel = guild.channels.cache.find(
      channel =>
        channel.name === LOG_CHANNEL_NAME &&
        channel.isTextBased()
    );

    if (!logChannel) {
      const channels = await guild.channels.fetch();

      logChannel = channels.find(
        channel =>
          channel &&
          channel.name === LOG_CHANNEL_NAME &&
          channel.isTextBased()
      );
    }

    if (!logChannel) {
      console.error(
        `❌ Could not find #${LOG_CHANNEL_NAME} in ${guild.name}.`
      );
      return;
    }

    const permissions =
      logChannel.permissionsFor(guild.members.me);

    if (
      !permissions ||
      !permissions.has(
        PermissionsBitField.Flags.ViewChannel
      ) ||
      !permissions.has(
        PermissionsBitField.Flags.SendMessages
      )
    ) {
      console.error(
        `❌ I cannot send messages in #${LOG_CHANNEL_NAME}.`
      );
      return;
    }

    await logChannel.send({
      embeds: [embed]
    });

    console.log(
      `✅ Moderation log sent to #${LOG_CHANNEL_NAME}`
    );
  } catch (error) {
    console.error(
      "❌ Could not send moderation log:",
      error
    );
  }
}

// =========================
// DURATION PARSER
// =========================

function parseDuration(input) {
  if (!input) return null;

  const match = input
    .toLowerCase()
    .trim()
    .match(/^(\d+)(s|m|h|d)$/);

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  const duration = amount * multipliers[unit];

  if (
    duration >
    28 * 24 * 60 * 60 * 1000
  ) {
    return null;
  }

  return duration;
}

// =========================
// JOIN DM MESSAGE
// =========================

function formatJoinDMMessage(message, member) {
  if (!message) return "";

  return message
    .replace(/{user}/gi, `<@${member.id}>`)
    .replace(/{username}/gi, member.user.username)
    .replace(/{server}/gi, member.guild.name)
    .replace(/{membercount}/gi, String(member.guild.memberCount));
}

async function sendJoinDM(member) {
  try {
    const settings = getJoinDMSettings(
      member.guild.id
    );

    if (!settings.enabled) {
      return;
    }

    if (!settings.message) {
      return;
    }

    const formattedMessage =
      formatJoinDMMessage(
        settings.message,
        member
      );

    await member.send({
      embeds: [
        baseEmbed(COLORS.info)
          .setTitle(
            `Welcome to ${member.guild.name}!`
          )
          .setDescription(formattedMessage)
          .setThumbnail(
            member.user.displayAvatarURL()
          )
      ]
    });

    console.log(
      `✅ Join DM sent to ${member.user.tag}`
    );
  } catch (error) {
    console.log(
      `⚠️ Could not DM ${member.user.tag}. Their DMs may be closed.`
    );
  }
}

// =========================
// JOIN EVENT
// =========================

client.on("guildMemberAdd", async member => {
  await sendJoinDM(member);
});

// =========================
// READY
// =========================

client.once("ready", async () => {
  console.log(
    `Logged in as ${client.user.tag}`
  );

  const commands = [
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
          description: "Example: 10m, 2h, 1d",
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
      name: "joindm",
      description: "Enable join DMs with a message",
      options: [
        {
          name: "message",
          description:
            "Message sent to users when they join",
          type: 3,
          required: true
        }
      ]
    },

    {
      name: "editjoindm",
      description: "Edit the join DM message",
      options: [
        {
          name: "message",
          description:
            "New message sent to users when they join",
          type: 3,
          required: true
        }
      ]
    },

    {
      name: "stopjoindm",
      description: "Disable join DMs"
    }
  ];

  const rest = new REST({
    version: "10"
  }).setToken(
    process.env.DISCORD_TOKEN
  );

  try {
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      {
        body: commands
      }
    );

    console.log(
      "Slash commands registered."
    );
  } catch (error) {
    console.error(
      "Slash command registration failed:",
      error
    );
  }
});

// =========================
// PREFIX COMMANDS
// =========================

client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content
    .slice(PREFIX.length)
    .trim()
    .split(/\s+/);

  const command =
    args.shift()?.toLowerCase();

  if (!command) return;

  // =====================
  // ADMIN COMMANDS
  // =====================

  const adminCommands = [
    "ban",
    "kick",
    "mute",
    "warn",
    "joindm",
    "editjoindm",
    "stopjoindm"
  ];

  if (
    adminCommands.includes(command) &&
    !isAdmin(message.member)
  ) {
    return message.reply({
      embeds: [
        errorEmbed(
          "Access Denied",
          "You need **Administrator** permission to use this command."
        )
      ]
    });
  }

  // =====================
  // TEST
  // =====================

  if (command === "test") {
    return message.reply({
      embeds: [
        successEmbed(
          "Bot Online",
          "Mog Moderation is working correctly."
        )
      ]
    });
  }

  // =====================
  // JOIN DM
  // =====================

  if (command === "joindm") {
    const joinMessage =
      args.join(" ").trim();

    if (!joinMessage) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Missing Message",
            `Usage: \`${PREFIX}joindm <message>\``
          )
        ]
      });
    }

    const settings =
      getJoinDMSettings(
        message.guild.id
      );

    settings.enabled = true;
    settings.message = joinMessage;

    saveJoinDMs();

    return message.reply({
      embeds: [
        successEmbed(
          "Join DMs Enabled",
          "Join DMs are now enabled.",
          [
            {
              name: "Message",
              value:
                joinMessage.length > 1024
                  ? joinMessage.slice(0, 1021) + "..."
                  : joinMessage
            },
            {
              name: "Available Variables",
              value:
                "`{user}` ` {username}` `{server}` `{membercount}`"
                  .replace("` {", "`{")
            }
          ]
        )
      ]
    });
  }

  // =====================
  // EDIT JOIN DM
  // =====================

  if (command === "editjoindm") {
    const joinMessage =
      args.join(" ").trim();

    if (!joinMessage) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Missing Message",
            `Usage: \`${PREFIX}editjoindm <message>\``
          )
        ]
      });
    }

    const settings =
      getJoinDMSettings(
        message.guild.id
      );

    settings.enabled = true;
    settings.message = joinMessage;

    saveJoinDMs();

    return message.reply({
      embeds: [
        successEmbed(
          "Join DM Updated",
          "The join DM message has been updated.",
          [
            {
              name: "New Message",
              value:
                joinMessage.length > 1024
                  ? joinMessage.slice(0, 1021) + "..."
                  : joinMessage
            }
          ]
        )
      ]
    });
  }

  // =====================
  // STOP JOIN DM
  // =====================

  if (command === "stopjoindm") {
    const settings =
      getJoinDMSettings(
        message.guild.id
      );

    settings.enabled = false;

    saveJoinDMs();

    return message.reply({
      embeds: [
        successEmbed(
          "Join DMs Disabled",
          "Automatic join DMs have been disabled."
        )
      ]
    });
  }

  // =====================
  // WARN
  // =====================

  if (command === "warn") {
    const target =
      message.mentions.members.first();

    if (!target) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Missing User",
            `Usage: \`${PREFIX}warn @user [reason]\``
          )
        ]
      });
    }

    if (
      !canModerate(
        message.member,
        target
      )
    ) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Cannot Warn Member",
            "You cannot warn yourself, the server owner, or a member with an equal/higher role."
          )
        ]
      });
    }

    const reason =
      args.slice(1).join(" ") ||
      "No reason provided";

    const caseNumber =
      getCaseNumber();

    const userWarnings =
      getUserWarnings(
        message.guild.id,
        target.id
      );

    userWarnings.push({
      case: caseNumber,
      reason,
      moderator: message.author.id,
      timestamp:
        new Date().toISOString()
    });

    saveWarnings();

    const warningCount =
      userWarnings.length;

    const embed =
      moderationEmbed({
        title: "Member Warned",
        description:
          `**${target.user.tag}** has been warned.`,
        target: target.user,
        moderator: message.author,
        reason,
        caseNumber,
        color: COLORS.warning
      });

    embed.addFields({
      name: "Total Warnings",
      value: `\`${warningCount}\``,
      inline: true
    });

    await message.reply({
      embeds: [embed]
    });

    const logEmbed =
      moderationEmbed({
        title: "Warning Issued",
        description:
          `A warning was issued to **${target.user.tag}**.`,
        target: target.user,
        moderator: message.author,
        reason,
        caseNumber,
        color: COLORS.warning
      });

    logEmbed.addFields({
      name: "Total Warnings",
      value: `\`${warningCount}\``,
      inline: true
    });

    return sendLog(
      message.guild,
      logEmbed
    );
  }

  // =====================
  // KICK
  // =====================

  if (command === "kick") {
    const target =
      message.mentions.members.first();

    if (!target) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Missing User",
            `Usage: \`${PREFIX}kick @user [reason]\``
          )
        ]
      });
    }

    if (
      !canModerate(
        message.member,
        target
      )
    ) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Cannot Kick Member",
            "You cannot kick yourself, the server owner, or a member with an equal/higher role."
          )
        ]
      });
    }

    if (
      !botCanModerate(
        message.guild,
        target
      )
    ) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Role Hierarchy",
            "My bot role must be higher than the member's highest role."
          )
        ]
      });
    }

    if (!target.kickable) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Kick Failed",
            "I don't have permission to kick this member."
          )
        ]
      });
    }

    const reason =
      args.slice(1).join(" ") ||
      "No reason provided";

    const caseNumber =
      getCaseNumber();

    try {
      await target.kick(reason);

      const embed =
        moderationEmbed({
          title: "Member Kicked",
          description:
            `**${target.user.tag}** has been kicked from the server.`,
          target: target.user,
          moderator: message.author,
          reason,
          caseNumber,
          color: COLORS.danger
        });

      await message.reply({
        embeds: [embed]
      });

      return sendLog(
        message.guild,
        embed
      );
    } catch (error) {
      console.error(error);

      return message.reply({
        embeds: [
          errorEmbed(
            "Kick Failed",
            "Something went wrong while kicking that member."
          )
        ]
      });
    }
  }

  // =====================
  // BAN
  // =====================

  if (command === "ban") {
    const target =
      message.mentions.members.first();

    if (!target) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Missing User",
            `Usage: \`${PREFIX}ban @user [reason]\``
          )
        ]
      });
    }

    if (
      !canModerate(
        message.member,
        target
      )
    ) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Cannot Ban Member",
            "You cannot ban yourself, the server owner, or a member with an equal/higher role."
          )
        ]
      });
    }

    if (
      !botCanModerate(
        message.guild,
        target
      )
    ) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Role Hierarchy",
            "My bot role must be higher than the member's highest role."
          )
        ]
      });
    }

    if (!target.bannable) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Ban Failed",
            "I don't have permission to ban this member."
          )
        ]
      });
    }

    const reason =
      args.slice(1).join(" ") ||
      "No reason provided";

    const caseNumber =
      getCaseNumber();

    try {
      await target.ban({
        reason
      });

      const embed =
        moderationEmbed({
          title: "Member Banned",
          description:
            `**${target.user.tag}** has been permanently banned.`,
          target: target.user,
          moderator: message.author,
          reason,
          caseNumber,
          color: COLORS.danger
        });

      await message.reply({
        embeds: [embed]
      });

      return sendLog(
        message.guild,
        embed
      );
    } catch (error) {
      console.error(error);

      return message.reply({
        embeds: [
          errorEmbed(
            "Ban Failed",
            "Something went wrong while banning that member."
          )
        ]
      });
    }
  }

  // =====================
  // MUTE
  // =====================

  if (command === "mute") {
    const target =
      message.mentions.members.first();

    if (!target) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Missing User",
            `Usage: \`${PREFIX}mute @user <duration> [reason]\``
          )
        ]
      });
    }

    if (
      !canModerate(
        message.member,
        target
      )
    ) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Cannot Mute Member",
            "You cannot mute yourself, the server owner, or a member with an equal/higher role."
          )
        ]
      });
    }

    if (
      !botCanModerate(
        message.guild,
        target
      )
    ) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Role Hierarchy",
            "My bot role must be higher than the member's highest role."
          )
        ]
      });
    }

    const durationInput =
      args[1];

    const duration =
      parseDuration(
        durationInput
      );

    if (!duration) {
      return message.reply({
        embeds: [
          errorEmbed(
            "Invalid Duration",
            "Use `17s`, `10m`, `2h`, or `7d`.\n\nMaximum: **28 days**."
          )
        ]
      });
    }

    const reason =
      args.slice(2).join(" ") ||
      "No reason provided";

    const caseNumber =
      getCaseNumber();

    try {
      await target.timeout(
        duration,
        reason
      );

      const embed =
        moderationEmbed({
          title: "Member Muted",
          description:
            `**${target.user.tag}** has been timed out.`,
          target: target.user,
          moderator: message.author,
          reason,
          caseNumber,
          color: COLORS.warning
        });

      embed.addFields({
        name: "Duration",
        value: `\`${durationInput}\``,
        inline: true
      });

      await message.reply({
        embeds: [embed]
      });

      return sendLog(
        message.guild,
        embed
      );
    } catch (error) {
      console.error(error);

      return message.reply({
        embeds: [
          errorEmbed(
            "Mute Failed",
            "Something went wrong while timing out that member."
          )
        ]
      });
    }
  }
});

// =========================
// SLASH COMMANDS
// =========================

client.on(
  "interactionCreate",
  async interaction => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (!interaction.guild) {
      return;
    }

    const command =
      interaction.commandName;

    // =====================
    // ADMIN CHECK
    // =====================

    const adminCommands = [
      "ban",
      "kick",
      "mute",
      "warn",
      "joindm",
      "editjoindm",
      "stopjoindm"
    ];

    if (
      adminCommands.includes(command) &&
      !isAdmin(interaction.member)
    ) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            "Access Denied",
            "You need **Administrator** permission to use this command."
          )
        ],
        ephemeral: true
      });
    }

    // =====================
    // JOIN DM
    // =====================

    if (command === "joindm") {
      const joinMessage =
        interaction.options
          .getString("message")
          .trim();

      const settings =
        getJoinDMSettings(
          interaction.guild.id
        );

      settings.enabled = true;
      settings.message = joinMessage;

      saveJoinDMs();

      return interaction.reply({
        embeds: [
          successEmbed(
            "Join DMs Enabled",
            "Join DMs are now enabled.",
            [
              {
                name: "Message",
                value:
                  joinMessage.length > 1024
                    ? joinMessage.slice(0, 1021) + "..."
                    : joinMessage
              },
              {
                name: "Variables",
                value:
                  "`{user}` • `{username}` • `{server}` • `{membercount}`"
              }
            ]
          )
        ]
      });
    }

    // =====================
    // EDIT JOIN DM
    // =====================

    if (command === "editjoindm") {
      const joinMessage =
        interaction.options
          .getString("message")
          .trim();

      const settings =
        getJoinDMSettings(
          interaction.guild.id
        );

      settings.enabled = true;
      settings.message = joinMessage;

      saveJoinDMs();

      return interaction.reply({
        embeds: [
          successEmbed(
            "Join DM Updated",
            "The join DM message has been updated.",
            [
              {
                name: "New Message",
                value:
                  joinMessage.length > 1024
                    ? joinMessage.slice(0, 1021) + "..."
                    : joinMessage
              }
            ]
          )
        ]
      });
    }

    // =====================
    // STOP JOIN DM
    // =====================

    if (command === "stopjoindm") {
      const settings =
        getJoinDMSettings(
          interaction.guild.id
        );

      settings.enabled = false;

      saveJoinDMs();

      return interaction.reply({
        embeds: [
          successEmbed(
            "Join DMs Disabled",
            "Automatic join DMs have been disabled."
          )
        ]
      });
    }

    // =====================
    // WARN
    // =====================

    if (command === "warn") {
      const targetUser =
        interaction.options.getUser(
          "user"
        );

      const target =
        await interaction.guild.members
          .fetch(targetUser.id)
          .catch(() => null);

      if (!target) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              "Member Not Found",
              "That user is not currently in this server."
            )
          ],
          ephemeral: true
        });
      }

      if (
        !canModerate(
          interaction.member,
          target
        )
      ) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              "Cannot Warn Member",
              "You cannot warn yourself, the server owner, or a member with an equal/higher role."
            )
          ],
          ephemeral: true
        });
      }

      const reason =
        interaction.options.getString(
          "reason"
        ) ||
        "No reason provided";

      const caseNumber =
        getCaseNumber();

      const userWarnings =
        getUserWarnings(
          interaction.guild.id,
          target.id
        );

      userWarnings.push({
        case: caseNumber,
        reason,
        moderator:
          interaction.user.id,
        timestamp:
          new Date().toISOString()
      });

      saveWarnings();

      const warningCount =
        userWarnings.length;

      const embed =
        moderationEmbed({
          title: "Member Warned",
          description:
            `**${target.user.tag}** has been warned.`,
          target: target.user,
          moderator: interaction.user,
          reason,
          caseNumber,
          color: COLORS.warning
        });

      embed.addFields({
        name: "Total Warnings",
        value: `\`${warningCount}\``,
        inline: true
      });

      await interaction.reply({
        embeds: [embed]
      });

      const logEmbed =
        moderationEmbed({
          title: "Warning Issued",
          description:
            `A warning was issued to **${target.user.tag}**.`,
          target: target.user,
          moderator: interaction.user,
          reason,
          caseNumber,
          color: COLORS.warning
        });

      logEmbed.addFields({
        name: "Total Warnings",
        value: `\`${warningCount}\``,
        inline: true
      });

      return sendLog(
        interaction.guild,
        logEmbed
      );
    }

    // =====================
    // KICK
    // =====================

    if (command === "kick") {
      const targetUser =
        interaction.options.getUser(
          "user"
        );

      const target =
        await interaction.guild.members
          .fetch(targetUser.id)
          .catch(() => null);

      if (!target) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              "Member Not Found",
              "That user is not currently in this server."
            )
          ],
          ephemeral: true
        });
      }

      if (
        !canModerate(
          interaction.member,
          target
        )
      ) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              "Cannot Kick Member",
              "You cannot kick yourself, the server owner, or a member with an equal/higher role."
            )
          ],
          ephemeral: true
        });
      }

      if (
        !botCanModerate(
          interaction.guild,
          target
        )
      ) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              "Role Hierarchy",
              "My bot role must be higher than the member's highest role."
            )
          ],
          ephemeral: true
        });
      }

      if (!target.kickable) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              "Kick Failed",
              "I don't have permission to kick this member."
            )
          ],
          ephemeral: true
        });
      }

      const reason =
        interaction.options.getString(
          "reason"
        ) ||
        "No reason provided";

      const caseNumber =
        getCaseNumber();

      try {
        await target.kick(reason);

        const embed =
          moderationEmbed({
            title: "Member Kicked",
            description:
              `**${target.user.tag}** has been kicked from the server.`,
            target: target.user,
            moderator:
              interaction.user,
            reason,
            caseNumber,
            color: COLORS.danger
          });

        await interaction.reply({
          embeds: [embed]
        });

        return sendLog(
          interaction.guild,
          embed
        );
      } catch (error) {
        console.error(error);

        return interaction.reply({
          embeds: [
            errorEmbed(
              "Kick Failed",
              "Something went wrong while kicking that member."
            )
          ],
          ephemeral: true
        });
      }
    }

    // =====================
    // BAN
    // =====================

    if (command === "ban") {
      const targetUser =
        interaction.options.getUser(
          "user"
        );

      const target =
        await interaction.guild.members
          .fetch(targetUser.id)
          .catch(() => null);

      if (!target) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              "Member Not Found",
              "That user is not currently in this server."
            )
          ],
          ephemeral: true
        });
      }

      if (
        !canModerate(
          interaction.member,
          target
        )
      ) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              "Cannot Ban Member",
              "You cannot ban yourself, the server owner, or a member with an equal/higher role."
            )
          ],
          ephemeral: true
        });
      }

      if (
        !botCanModerate(
          interaction.guild,
          target
        )
      ) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              "Role Hierarchy",
              "My bot role must be higher than the member's highest role."
            )
          ],
          ephemeral: true
        });
      }

      if (!target.bannable) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              "Ban Failed",
              "I don't have permission to ban this member."
            )
          ],
          ephemeral: true
        });
      }

      const reason =
        interaction.options.getString(
          "reason"
        ) ||
        "No reason provided";

      const caseNumber =
        getCaseNumber();

      try {
        await target.ban({
          reason
        });

        const embed =
          moderationEmbed({
            title: "Member Banned",
            description:
              `**${target.user.tag}** has been permanently banned.`,
            target: target.user,
            moderator:
              interaction.user,
            reason,
            caseNumber,
            color: COLORS.danger
          });

        await interaction.reply({
          embeds: [embed]
        });

        return sendLog(
          interaction.guild,
          embed
        );
      } catch (error) {
        console.error(error);

        return interaction.reply({
          embeds: [
            errorEmbed(
              "Ban Failed",
              "Something went wrong while banning that member."
            )
          ],
          ephemeral: true
        });
      }
    }

    // =====================
    // MUTE
    // =====================

    if (command === "mute") {
      const targetUser =
        interaction.options.getUser(
          "user"
        );

      const target =
        await interaction.guild.members
          .fetch(targetUser.id)
          .catch(() => null);

      if (!target) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              "Member Not Found",
              "That user is not currently in this server."
            )
          ],
          ephemeral: true
        });
      }

      if (
        !canModerate(
          interaction.member,
          target
        )
      ) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              "Cannot Mute Member",
              "You cannot mute yourself, the server owner, or a member with an equal/higher role."
            )
          ],
          ephemeral: true
        });
      }

      if (
        !botCanModerate(
          interaction.guild,
          target
        )
      ) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              "Role Hierarchy",
              "My bot role must be higher than the member's highest role."
            )
          ],
          ephemeral: true
        });
      }

      const durationInput =
        interaction.options.getString(
          "duration"
        );

      const duration =
        parseDuration(
          durationInput
        );

      if (!duration) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              "Invalid Duration",
              "Use `17s`, `10m`, `2h`, or `7d`.\n\nMaximum: **28 days**."
            )
          ],
          ephemeral: true
        });
      }

      const reason =
        interaction.options.getString(
          "reason"
        ) ||
        "No reason provided";

      const caseNumber =
        getCaseNumber();

      try {
        await target.timeout(
          duration,
          reason
        );

        const embed =
          moderationEmbed({
            title: "Member Muted",
            description:
              `**${target.user.tag}** has been timed out.`,
            target: target.user,
            moderator:
              interaction.user,
            reason,
            caseNumber,
            color: COLORS.warning
          });

        embed.addFields({
          name: "Duration",
          value: `\`${durationInput}\``,
          inline: true
        });

        await interaction.reply({
          embeds: [embed]
        });

        return sendLog(
          interaction.guild,
          embed
        );
      } catch (error) {
        console.error(error);

        return interaction.reply({
          embeds: [
            errorEmbed(
              "Mute Failed",
              "Something went wrong while timing out that member."
            )
          ],
          ephemeral: true
        });
      }
    }
  }
);

// =========================
// EXPRESS SERVER
// =========================

const app = express();

app.get("/", (req, res) => {
  res.send(
    "Mog Moderation is online."
  );
});

app.listen(3000, () => {
  console.log(
    "Web server running on port 3000."
  );
});

// =========================
// LOGIN
// =========================

client.login(
  process.env.DISCORD_TOKEN
);