import type { ParticipantSummary } from "@absensi/shared";
import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronsUpDown, LoaderCircle, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";

import { mergeSelectedResult, participantOptionHint } from "@/lib/participant-picker";
import { listParticipants } from "@/lib/participants";
import { cn } from "@/lib/utils";

const SEARCH_LIMIT = 20;
const DEBOUNCE_MS = 250;

type SearchState = "idle" | "loading" | "ready" | "error";

/**
 * Accessible participant picker (Base UI combobox) with server-side search.
 *
 * Replaces the "type + press Cari + click a row" flow in Manual Entry and the
 * consumption quota dialog: arrow keys, type-ahead, and an announced result
 * count come from the primitive, and only one small request is sent per pause
 * in typing. The selected participant is kept in the list even when a newer
 * search no longer returns them.
 *
 * Rendered inside a native `<dialog>`; the popup is portaled into that dialog
 * so it stays in the top layer and is not clipped by the dialog scroller.
 */
export function ParticipantCombobox({
  themeId,
  value,
  onChange,
  disabled,
  placeholder = "Cari nama, NIK, atau email",
  ...inputProps
}: {
  themeId: string;
  value: ParticipantSummary | null;
  onChange: (participant: ParticipantSummary | null) => void;
  disabled?: boolean;
  placeholder?: string;
} & Omit<ComponentProps<"input">, "value" | "onChange" | "disabled" | "placeholder">) {
  const [results, setResults] = useState<ParticipantSummary[]>([]);
  const [state, setState] = useState<SearchState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState(value?.fullName ?? "");
  const [container, setContainer] = useState<HTMLElement | null>(null);

  const anchorRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);

  // Portal into the surrounding <dialog> when there is one; body otherwise.
  useEffect(() => {
    setContainer(anchorRef.current?.closest("dialog") ?? null);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      controller.current?.abort();
    },
    [],
  );

  // Reflect a selection made elsewhere (or a reset) without wiping typed text.
  useEffect(() => {
    if (value) setInputValue(value.fullName);
  }, [value]);

  const items = useMemo(() => mergeSelectedResult(results, value), [results, value]);

  function runSearch(term: string) {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;

    setState("loading");
    setError(null);

    listParticipants(themeId, { query: term, status: "active", limit: SEARCH_LIMIT })
      .then((body) => {
        if (next.signal.aborted) return;
        if (!body.ok) {
          setState("error");
          setError(body.error.message);
          return;
        }
        setResults(body.data.items);
        setState("ready");
      })
      .catch(() => {
        if (next.signal.aborted) return;
        setState("error");
        setError("Tidak bisa menghubungi server");
      });
  }

  // Show the first page as soon as the dialog opens, so the list is not empty.
  useEffect(() => {
    runSearch("");
  }, [themeId]);

  function scheduleSearch(term: string) {
    if (timer.current) clearTimeout(timer.current);

    const trimmed = term.trim();
    if (trimmed === "") {
      controller.current?.abort();
      setResults([]);
      setState("idle");
      setError(null);
      return;
    }

    timer.current = setTimeout(() => runSearch(trimmed), DEBOUNCE_MS);
  }

  const status =
    state === "loading" ? (
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
        Mencari peserta…
      </span>
    ) : state === "error" ? (
      <span className="text-xs text-red-600">{error}</span>
    ) : null;

  return (
    <Combobox.Root
      items={items}
      value={value}
      onValueChange={(next) => {
        onChange(next);
        setInputValue(next?.fullName ?? "");
      }}
      inputValue={inputValue}
      onInputValueChange={(next, details) => {
        setInputValue(next);

        // Typing after a pick invalidates the pick: the operator must choose
        // again, otherwise the displayed text and the recorded participant
        // could disagree. `item-press` is the label being written by a pick.
        if (details.reason === "item-press") return;
        if (value && next !== value.fullName) onChange(null);

        scheduleSearch(next);
      }}
      itemToStringLabel={(participant) => participant.fullName}
      isItemEqualToValue={(item, selected) => item.id === selected?.id}
      filter={null}
      disabled={disabled}
    >
      <div ref={anchorRef} className="relative">
        <Combobox.Input
          {...inputProps}
          className={cn(
            "flex h-10 w-full rounded-md border border-border bg-background px-3 pr-16 text-sm text-foreground transition-colors placeholder:text-muted-foreground/70 focus-visible:border-foreground/40 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            inputProps.className,
          )}
          placeholder={placeholder}
        />
        <span className="absolute inset-y-0 right-0 flex items-center gap-0.5 pr-1">
          {value && (
            <Combobox.Clear
              aria-label="Hapus pilihan peserta"
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X aria-hidden="true" className="size-4" />
            </Combobox.Clear>
          )}
          <Combobox.Trigger
            aria-label="Buka daftar peserta"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronsUpDown aria-hidden="true" className="size-4" />
          </Combobox.Trigger>
        </span>
      </div>

      <Combobox.Portal container={container}>
        <Combobox.Positioner sideOffset={4} className="z-50 outline-none">
          <Combobox.Popup className="w-[var(--anchor-width)] max-w-[var(--available-width)] rounded-md border border-border bg-background p-1 text-foreground shadow-lg">
            <div className="max-h-[min(var(--available-height),18rem)] overflow-y-auto overscroll-contain">
              <Combobox.Status>
                {status ? <div className="px-2 py-1.5">{status}</div> : null}
              </Combobox.Status>
              <Combobox.Empty>
                {state === "ready" ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    Tidak ada peserta aktif yang cocok.
                  </p>
                ) : null}
              </Combobox.Empty>
              <Combobox.List>
                {(participant: ParticipantSummary) => (
                  <Combobox.Item
                    key={participant.id}
                    value={participant}
                    className="grid cursor-default grid-cols-[1rem_1fr] items-start gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-muted"
                  >
                    <Combobox.ItemIndicator className="col-start-1 mt-1">
                      <Check aria-hidden="true" className="size-3.5" />
                    </Combobox.ItemIndicator>
                    <span className="col-start-2 min-w-0">
                      <span className="block truncate font-medium">{participant.fullName}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {participantOptionHint(participant)}
                      </span>
                    </span>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </div>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
