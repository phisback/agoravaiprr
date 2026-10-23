import prisma from '../database/client.js';

function idList(...values) {
  return [...new Set(
    values
      .flatMap(value => String(value ?? '').split(','))
      .map(value => value.trim())
      .filter(Boolean),
  )];
}

function isPartnershipTicket(label = '') {
  return /\b(parceria|parcerias|partner|partnership)\b/i.test(label);
}

export async function getTicketNotificationTargets(ticket) {
  const [config, option] = await Promise.all([
    prisma.guildConfig.findUnique({ where: { guildId: ticket.guildId } }),
    ticket.reason
      ? prisma.ticketOption.findFirst({ where: { guildId: ticket.guildId, label: ticket.reason } })
      : null,
  ]);

  const partnershipTicket = isPartnershipTicket(ticket.reason ?? '');
  return {
    roleIds: idList(
      option?.pingRole,
      config?.ticketPingRole,
      partnershipTicket ? config?.partnerResponsibleRole : null,
    ),
    userIds: idList(option?.pingUser, config?.ticketPingUser),
  };
}

export function memberHasTicketRole(member, roleIds) {
  const roles = member?.roles;
  if (roles?.cache?.has) {
    return roleIds.some(roleId => roles.cache.has(roleId));
  }

  const memberRoleIds = Array.isArray(roles)
    ? roles
    : Array.isArray(member?.roleIds)
      ? member.roleIds
      : [];
  return roleIds.some(roleId => memberRoleIds.includes(roleId));
}

export function canAssumeTicket(member, roleIds) {
  return memberHasTicketRole(member, roleIds);
}

export function canCloseTicket(ticket, userId, member, roleIds) {
  return ticket?.claimedBy === userId || memberHasTicketRole(member, roleIds);
}
