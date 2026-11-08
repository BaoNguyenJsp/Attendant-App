// Permission checks on an actor (the session): { tier, classIds, sectorGroupIds }. Plan section 4.
import { TIER_RANK } from './codes.js';
import { fail } from './errors.js';

export const isAdmin = (actor) => actor.tier === 'ADMIN';
export const atLeast = (actor, tier) => (TIER_RANK[actor.tier] ?? 0) >= TIER_RANK[tier];
export const canManageSector = (actor, sectorGroupId) => isAdmin(actor) || actor.sectorGroupIds.includes(sectorGroupId);

export function requireTier(actor, tier) {
  if (!atLeast(actor, tier)) fail(403, 'Bạn không có quyền thực hiện thao tác này.');
}

// R3: writing needs the class in scope.
export function requireClass(actor, classId) {
  if (!isAdmin(actor) && !actor.classIds.includes(classId)) fail(403, 'Lớp không nằm trong phạm vi của bạn.');
}
