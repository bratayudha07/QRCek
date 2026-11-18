import { describe, expect, it } from "vitest";

import { documentTitle } from "./document-title";

describe("documentTitle", () => {
  it("names the screen and the product", () => {
    expect(documentTitle("Peserta")).toBe("Peserta — QRCek");
  });

  it("adds the detail between the screen and the product", () => {
    expect(documentTitle("Peserta", "Mhs")).toBe("Peserta · Mhs — QRCek");
  });

  it("ignores an empty detail instead of leaving a separator", () => {
    expect(documentTitle("Peserta", "")).toBe("Peserta — QRCek");
    expect(documentTitle("Peserta", null)).toBe("Peserta — QRCek");
  });
});
