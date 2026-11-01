import { describe, expect, it } from "vitest";

import { eventPath, importPath, parseRoute, participantPath } from "./router";

describe("parseRoute", () => {
  it.each([
    ["/", "events"],
    ["/acara", "events"],
    ["/akun", "account"],
    ["/masuk", "login"],
    ["/aktivasi", "activation"],
  ] as const)("maps %s to %s", (path, name) => {
    expect(parseRoute(path).name).toBe(name);
  });

  it("ignores trailing slashes", () => {
    expect(parseRoute("/acara/")).toEqual({ name: "events" });
    expect(parseRoute("/acara/EVT/")).toEqual({ name: "event", eventId: "EVT" });
  });

  it("parses event detail", () => {
    expect(parseRoute("/acara/01JEVENT")).toEqual({ name: "event", eventId: "01JEVENT" });
  });

  it("parses participant detail", () => {
    expect(parseRoute("/acara/01JEVENT/peserta/01JPART")).toEqual({
      name: "participant",
      eventId: "01JEVENT",
      participantId: "01JPART",
    });
  });

  it("parses the import wizard", () => {
    expect(parseRoute("/acara/01JEVENT/impor")).toEqual({
      name: "import",
      eventId: "01JEVENT",
    });
  });

  it("decodes URL-encoded ids", () => {
    expect(parseRoute("/acara/a%20b")).toEqual({ name: "event", eventId: "a b" });
  });

  it.each(["/foo", "/acara/EVT/peserta", "/acara/EVT/lain", "/akun/extra"])(
    "returns notFound for %s",
    (path) => {
      expect(parseRoute(path)).toEqual({ name: "notFound" });
    },
  );

  it("builds canonical paths", () => {
    expect(eventPath("EVT")).toBe("/acara/EVT");
    expect(participantPath("EVT", "P1")).toBe("/acara/EVT/peserta/P1");
    expect(importPath("EVT")).toBe("/acara/EVT/impor");
  });

  it("encodes ids in generated paths", () => {
    expect(eventPath("a/b")).toBe("/acara/a%2Fb");
  });
});
