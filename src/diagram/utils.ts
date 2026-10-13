export const round = (value: number) => Math.round(value * 1000) / 1000;
export async function digest(value: unknown): Promise<string> {
  const data = value instanceof Uint8Array ? value : new TextEncoder().encode(JSON.stringify(value));
  const hashed = await crypto.subtle.digest('SHA-256', new Uint8Array(data).buffer);
  return Array.from(new Uint8Array(hashed), byte => byte.toString(16).padStart(2, '0')).join('');
}
