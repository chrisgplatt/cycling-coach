// Pure power-zone helpers. Kept dependency-free (no Claude client import) so
// prompt builders can format watt ranges without pulling in the Anthropic SDK.

export function formatZones(ftp: number): string {
  const z = (lo: number, hi: number) => `${Math.round(ftp * lo)}–${Math.round(ftp * hi)}W`
  return [
    `  Recovery  (Z1): <${Math.round(ftp * 0.55)}W`,
    `  Endurance (Z2): ${z(0.56, 0.75)}`,
    `  Tempo     (Z3): ${z(0.76, 0.90)}`,
    `  Threshold (Z4): ${z(0.91, 1.05)}`,
    `  VO2max    (Z5): ${z(1.06, 1.20)}`,
    `  Anaerobic (Z6): >${Math.round(ftp * 1.20)}W`,
  ].join('\n')
}
