/** One decimal place, trailing ".0" dropped: 212 → "212", 12.345 → "12.3". */
export const fmtNum = (n: number) => String(Math.round(n * 10) / 10)
