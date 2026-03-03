/**
 * Membership role constants matching the backend Django model.
 * 
 * These values match the Membership model in apps/backend/member/models.py:
 * - MEMBER = 1
 * - LEADER = 2
 */
export const MembershipRole = {
  MEMBER: 1,
  LEADER: 2,
} as const;

export type MembershipRoleType = typeof MembershipRole[keyof typeof MembershipRole];

