const CUSTOM_EMOJI_PATTERN = /^<(a?):[\w~+-]+:(\d{17,20})>$/;
const EMOJI_ID_PATTERN = /^\d{17,20}$/;

export function parseVipRoleIconInput(rawInput, attachment = null) {
  const raw = String(rawInput ?? '').trim();

  if (attachment?.url) {
    return { icon: attachment.url, unicodeEmoji: null };
  }

  if (!raw) {
    return { icon: undefined, unicodeEmoji: undefined };
  }

  if (raw.toLowerCase() === 'remover') {
    return { icon: null, unicodeEmoji: null };
  }

  const customEmoji = raw.match(CUSTOM_EMOJI_PATTERN);
  const emojiId = customEmoji?.[2] ?? (EMOJI_ID_PATTERN.test(raw) ? raw : null);
  if (emojiId) {
    const extension = customEmoji?.[1] === 'a' ? 'gif' : 'png';
    return {
      icon: `https://cdn.discordapp.com/emojis/${emojiId}.${extension}`,
      unicodeEmoji: null,
    };
  }

  return { icon: null, unicodeEmoji: raw };
}
