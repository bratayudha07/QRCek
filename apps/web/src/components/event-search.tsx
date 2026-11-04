import { ArrowRight, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { paletteActions, type PaletteAction } from "@/lib/palette";
import { eventTabPath, navigate, participantsPath, type EventTab } from "@/lib/router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Command palette for the event workspace: one entry point to search
 * participants and to jump between the event tabs.
 *
 * The toolbar button is the pointer trigger; `Ctrl/⌘ K` opens it from anywhere
 * on the page. The panel is a native `<dialog>` driven by `showModal()`, so the
 * focus trap, the inert background, and Escape come from the platform instead of
 * hand-written key handling. Arrow keys move the highlighted row and the input
 * keeps focus, which is the combobox pattern screen readers expect.
 *
 * The action list is pure (`lib/palette.ts`); this component only renders it and
 * calls the existing router helpers. It never fetches anything.
 */
export function EventSearch({
  eventId,
  activeTab,
}: {
  eventId: string;
  activeTab?: EventTab | null;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [highlight, setHighlight] = useState(0);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenedRef = useRef(false);

  const baseId = useId();
  const listId = `${baseId}-actions`;
  const titleId = `${baseId}-title`;

  const actions = useMemo(() => paletteActions(term, activeTab), [term, activeTab]);
  const shortcut = useMemo(() => (isApplePlatform() ? "⌘K" : "Ctrl K"), []);

  // Opening and closing is imperative: `showModal()` is what moves the dialog
  // into the top layer and makes the rest of the page inert.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) dialog.showModal();
      inputRef.current?.focus();
      return;
    }

    if (dialog.open) dialog.close();
  }, [open]);

  // Start fresh on open, and give focus back on close: a palette that swallows
  // focus strands keyboard users inside the top layer.
  useEffect(() => {
    if (open) {
      wasOpenedRef.current = true;
      setTerm("");
      setHighlight(0);
      return;
    }

    if (wasOpenedRef.current) triggerRef.current?.focus();
  }, [open]);

  // `Ctrl/⌘ K` is a shortcut, not a global grab: leave it alone while a field
  // has focus and when another modifier is held.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key.toLowerCase() !== "k") return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.altKey || event.shiftKey) return;
      if (event.target instanceof HTMLElement && isTextField(event.target)) return;

      event.preventDefault();
      setOpen((value) => !value);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Keep the highlighted row inside the scrollable list while arrowing.
  useEffect(() => {
    if (!open) return;

    const row = listRef.current?.children[highlight];
    if (row instanceof HTMLElement) row.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  function run(action: PaletteAction) {
    setOpen(false);

    if (action.kind === "search") {
      navigate(`${participantsPath(eventId)}?q=${encodeURIComponent(action.term)}`);
      return;
    }

    navigate(eventTabPath(eventId, action.tab));
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (actions.length === 0) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setHighlight((index) => (index + 1) % actions.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setHighlight((index) => (index - 1 + actions.length) % actions.length);
        break;
      case "Home":
        event.preventDefault();
        setHighlight(0);
        break;
      case "End":
        event.preventDefault();
        setHighlight(actions.length - 1);
        break;
      case "Enter": {
        const action = actions[highlight];
        if (!action) return;
        event.preventDefault();
        run(action);
        break;
      }
    }
  }

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        className="h-10 w-full justify-start gap-2 rounded-full bg-background/80 px-3 text-left font-normal text-muted-foreground hover:border-foreground/20 hover:text-foreground"
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <span className="truncate">Cari peserta…</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium lg:inline-block">
          {shortcut}
        </kbd>
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          // A click on the backdrop reports the dialog itself as the target.
          if (event.target === dialogRef.current) setOpen(false);
        }}
        className="w-[min(32rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-slate-950/40 backdrop:backdrop-blur-[2px]"
      >
        {open && (
          <div className="palette-enter flex max-h-[min(78dvh,34rem)] flex-col">
            <h2 id={titleId} className="sr-only">
              Cari peserta dan navigasi acara
            </h2>

            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <Input
                ref={inputRef}
                type="text"
                value={term}
                onChange={(event) => {
                  setTerm(event.target.value);
                  setHighlight(0);
                }}
                onKeyDown={onInputKeyDown}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={actions.length > 0 ? `${listId}-${highlight}` : undefined}
                aria-label="Cari peserta atau pilih tab"
                placeholder="Cari peserta atau pilih tab…"
                className="h-12 min-w-0 flex-1 border-0 bg-transparent px-0 focus-visible:outline-none"
              />
              <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                Esc
              </kbd>
            </div>

            {actions.length > 0 ? (
              <ul
                ref={listRef}
                id={listId}
                role="listbox"
                aria-label="Tindakan"
                className="min-h-0 overflow-y-auto p-1.5"
              >
                {actions.map((action, index) => {
                  const isActive = index === highlight;

                  return (
                    <li
                      key={action.id}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => run(action)}
                      className={cn(
                        "flex cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors duration-100",
                        isActive ? "bg-muted text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {action.kind === "search" ? (
                        <Search aria-hidden="true" className="size-4 shrink-0" />
                      ) : (
                        <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
                      )}
                      <span className="truncate">{action.label}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Tidak ada tindakan yang cocok.
              </p>
            )}

            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              ↑↓ memilih · Enter membuka · Esc menutup
            </p>
          </div>
        )}
      </dialog>
    </>
  );
}

/** Mac keyboards use Command; showing "Ctrl K" there would be a lie. */
function isApplePlatform(): boolean {
  return /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** The shortcut must not fire while the user is typing somewhere else. */
function isTextField(element: HTMLElement): boolean {
  if (element.isContentEditable) return true;

  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT";
}
