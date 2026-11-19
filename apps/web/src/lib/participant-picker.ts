import type { ParticipantSummary } from "@absensi/shared";

/**
 * Pure helpers for the participant picker. Kept out of the component so the
 * merge rule (a selected participant must stay visible even when a newer search
 * no longer returns them) is unit tested without a DOM.
 */

/** Puts the selected participant first when the latest results omit it. */
export function mergeSelectedResult(
  results: readonly ParticipantSummary[],
  selected: ParticipantSummary | null,
): ParticipantSummary[] {
  if (!selected) return [...results];
  if (results.some((participant) => participant.id === selected.id)) return [...results];
  return [selected, ...results];
}

/** Secondary line under a participant's name. */
export function participantOptionHint(
  participant: Pick<ParticipantSummary, "externalRef" | "category">,
): string {
  return participant.externalRef || participant.category || "Tanpa kategori";
}
