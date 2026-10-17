export const SHARED_IMAGE_BYTES = 4 * 1024 * 1024;
export const SHARED_STORAGE_BYTES = 128 * 1024 * 1024;
export const SHARED_ASSET_LIMIT = 500;

export type SharedAsset = {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  width: number;
  height: number;
  bytes: number;
  status: "pending" | "ready" | "deleting";
  createdAt: string;
  canManage: boolean;
  imageUrl?: string;
};
export type WorkshopIdentity = {
  configured: boolean;
  storageConfigured: boolean;
  registrationConfigured: boolean;
  user: { id: string; name: string } | null;
  guild: { id: string; name: string; isAdmin: boolean; canCreateEmoji?: boolean } | null;
};

export function canManageAsset(ownerId: string, userId: string, isAdmin: boolean) {
  return ownerId === userId || isAdmin;
}
export function assetName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 80 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
}
export function guildAdministrator(guild: { owner?: boolean; permissions?: string }) {
  // Discord's Administrator permission, plus the server owner.
  return guild.owner === true || (typeof guild.permissions === "string" && /^\d+$/.test(guild.permissions) && (BigInt(guild.permissions) & BigInt(8)) !== BigInt(0));
}

export function guildEmojiCreator(guild: { owner?: boolean; permissions?: string }) {
  return guildAdministrator(guild) || (typeof guild.permissions === "string" && /^\d+$/.test(guild.permissions) && (BigInt(guild.permissions) & (BigInt(1) << BigInt(43))) !== BigInt(0));
}

export function guildUrl(path: string, guildId: string) { return `${path}${path.includes("?") ? "&" : "?"}guildId=${encodeURIComponent(guildId)}`; }
