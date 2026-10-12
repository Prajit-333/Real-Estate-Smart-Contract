export async function hashFile(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
