import type { QrLabelItem, QrLabelPayload } from "@absensi/shared";
import { A4_LABELS_PER_PAGE } from "@absensi/shared";

import { QrCode } from "./qr-code";
import { orderedLabelValues, paginateLabels, type LabelFormat } from "@/lib/qr-labels";

/**
 * The printable surface, shared by the on-screen preview and `window.print()`.
 *
 * A4 is a 3 × 8 grid split into explicit pages, so a page break can never cut a
 * label. The 50 × 30 mm format prints one label per page, which is what a
 * dedicated label printer expects.
 */
export function LabelSheet({
  payload,
  format,
}: {
  payload: QrLabelPayload;
  format: LabelFormat;
}) {
  if (payload.labels.length === 0) return null;

  if (format === "sticker") {
    return (
      <div className="label-sheet label-sheet-sticker" data-testid="sticker-sheet">
        {payload.labels.map((label) => (
          <LabelCell
            key={label.participantId}
            payload={payload}
            label={label}
            qrSizeMm={20}
          />
        ))}
      </div>
    );
  }

  const pages = paginateLabels(payload.labels, A4_LABELS_PER_PAGE);

  return (
    <div className="label-sheet label-sheet-a4" data-testid="a4-sheet">
      {pages.map((page, pageIndex) => (
        <div className="label-page" key={`page-${pageIndex}`}>
          {page.map((label) => (
            <LabelCell
              key={label.participantId}
              payload={payload}
              label={label}
              qrSizeMm={21}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function LabelCell({
  payload,
  label,
  qrSizeMm,
}: {
  payload: QrLabelPayload;
  label: QrLabelItem;
  qrSizeMm: number;
}) {
  const lines = orderedLabelValues(payload.fields, label.values);

  return (
    <article className="label-cell">
      <QrCode value={label.qr} sizeMm={qrSizeMm} />

      <div className="label-text">
        {payload.showEventName && <p className="label-event">{payload.event.name}</p>}
        {lines.map((line, index) => (
          <p key={`${label.participantId}-${index}`} className={index === 0 ? "label-primary" : "label-line"}>
            {line}
          </p>
        ))}
      </div>
    </article>
  );
}
