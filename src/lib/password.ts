// FARO — hashing de contraseñas (scrypt). Módulo puro (node:crypto): usable
// desde la app Next y desde el worker sin dependencias de request.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expect = Buffer.from(hash, "hex");
  const got = scryptSync(password, salt, expect.length);
  return expect.length === got.length && timingSafeEqual(expect, got);
}
