/**
 * URL slug for events.
 *
 * The `events.slug` column is UNIQUE, but the UI never asks for a slug. The
 * suffix derived from the event id makes collisions impossible without a
 * second round trip or a retry loop, while the readable prefix keeps links
 * legible (`/acara/wisuda-2026-01jk...`).
 */

const MAX_PREFIX = 40;

export function slugify(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_PREFIX)
    .replace(/-+$/g, "");

  return normalized === "" ? "acara" : normalized;
}

export function eventSlug(name: string, id: string): string {
  const suffix = id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-6);
  return `${slugify(name)}-${suffix}`.slice(0, 60);
}
