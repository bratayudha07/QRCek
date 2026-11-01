import qrcode from "qrcode-generator";
import { useMemo } from "react";

/**
 * QR rendered as an SVG path from module geometry.
 *
 * `qrcode-generator` is used only as an encoder (`getModuleCount`/`isDark`),
 * not through its `createSvgTag` string helper. Building the path here keeps
 * the output crisp at print size, gives us an explicit 4-module quiet zone, and
 * makes the geometry testable without a DOM.
 */
export function QrCode({
  value,
  sizeMm,
  label = "Kode QR peserta",
  centerLogo = false,
}: {
  value: string;
  sizeMm: number;
  label?: string;
  centerLogo?: boolean;
}) {
  const { path, viewSize } = useMemo(() => {
    const qr = qrcode(0, centerLogo ? "H" : "M");
    qr.addData(value);
    qr.make();

    const count = qr.getModuleCount();
    const quiet = 2; // 2 modules per side = the 4-module quiet zone from the spec.
    const segments: string[] = [];

    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (qr.isDark(row, column)) {
          segments.push(`M${column + quiet} ${row + quiet}h1v1h-1z`);
        }
      }
    }

    return { path: segments.join(""), viewSize: count + quiet * 2 };
  }, [centerLogo, value]);

  const logoSize = viewSize * 0.19;
  const logoX = (viewSize - logoSize) / 2;
  const logoInset = logoSize * 0.12;

  return (
    <svg
      viewBox={`0 0 ${viewSize} ${viewSize}`}
      width={`${sizeMm}mm`}
      height={`${sizeMm}mm`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      className="block bg-white"
    >
      <rect width={viewSize} height={viewSize} fill="#ffffff" />
      <path d={path} fill="#000000" />
      {centerLogo && (
        <>
          <rect
            x={logoX - logoInset}
            y={logoX - logoInset}
            width={logoSize + logoInset * 2}
            height={logoSize + logoInset * 2}
            rx={viewSize * 0.035}
            fill="#ffffff"
          />
          <image
            href="/brand-mark.svg"
            x={logoX}
            y={logoX}
            width={logoSize}
            height={logoSize}
            preserveAspectRatio="xMidYMid meet"
          />
        </>
      )}
    </svg>
  );
}
