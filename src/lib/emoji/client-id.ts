// Editor-local identifiers also work on a phone over a LAN HTTP connection.
// Unlike randomUUID(), getRandomValues() does not require a secure context.
export function createLayerId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}
