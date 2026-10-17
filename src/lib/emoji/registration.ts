export const EMOJI_UPLOAD_BYTES = 256 * 1024;
export function emojiName(value: unknown): string | null {
  return typeof value === "string" && value === value.trim() && /^[A-Za-z0-9_]{2,32}$/.test(value) ? value : null;
}
export type RegistrationResult = {
  requestId: string;
  name: string;
  status: "pending" | "succeeded" | "failed" | "unknown";
  emojiId: string | null;
  message: string;
  retryAfter: number;
};
