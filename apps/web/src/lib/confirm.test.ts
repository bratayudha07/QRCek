import { describe, expect, it } from "vitest";

import { resolveConfirmCopy } from "./confirm";

describe("resolveConfirmCopy", () => {
  it("keeps an explicit title and description", () => {
    const copy = resolveConfirmCopy({
      title: "Hapus acara ini?",
      description: "Hanya draf tanpa peserta yang dapat dihapus permanen.",
      confirmLabel: "Hapus acara",
    });

    expect(copy).toEqual({
      title: "Hapus acara ini?",
      description: "Hanya draf tanpa peserta yang dapat dihapus permanen.",
      confirmLabel: "Hapus acara",
      cancelLabel: "Batal",
      tone: "default",
    });
  });

  it("defaults to a neutral confirm label", () => {
    expect(resolveConfirmCopy({ title: "Lanjut?" }).confirmLabel).toBe("Lanjutkan");
  });

  it("defaults a destructive confirm label and keeps the tone", () => {
    const copy = resolveConfirmCopy({ title: "Cabut akses?", tone: "destructive" });

    expect(copy.tone).toBe("destructive");
    expect(copy.confirmLabel).toBe("Ya, lanjutkan");
  });

  it("lets a destructive action override the default label", () => {
    expect(
      resolveConfirmCopy({ title: "Hapus?", tone: "destructive", confirmLabel: "Hapus" })
        .confirmLabel,
    ).toBe("Hapus");
  });

  it("allows a custom cancel label", () => {
    expect(resolveConfirmCopy({ title: "Lanjut?", cancelLabel: "Kembali" }).cancelLabel).toBe(
      "Kembali",
    );
  });

  it("omits the description when none is given", () => {
    expect(resolveConfirmCopy({ title: "Lanjut?" }).description).toBeUndefined();
  });
});
