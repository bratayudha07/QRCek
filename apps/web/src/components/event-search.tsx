import { Search } from "lucide-react";
import { useState, type FormEvent } from "react";

import { navigate, participantsPath } from "@/lib/router";

/**
 * Quick find for the event workspace.
 *
 * Participants are the only searchable list today, so submitting jumps to the
 * Peserta tab and hands the term over as `?q=`. Keeping the target explicit is
 * better than a toolbar input that silently filters nothing; when more lists
 * become searchable this is the one place that decides where the term goes.
 */
export function EventSearch({ eventId }: { eventId: string }) {
  const [term, setTerm] = useState("");

  function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();

    const query = term.trim();
    const target = participantsPath(eventId);

    navigate(query === "" ? target : `${target}?q=${encodeURIComponent(query)}`);
  }

  return (
    <form role="search" onSubmit={submit} className="relative">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Cari peserta…"
        aria-label="Cari peserta di acara ini"
        className="h-10 w-full rounded-full border border-border bg-background/80 pl-9 pr-3 text-sm transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
      />
    </form>
  );
}
