/** Deterministic djb2 hash → unsigned 32-bit integer */
function djb2(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ (str.charCodeAt(i) ?? 0)
    hash = hash >>> 0
  }
  return hash
}

/** Derive 1-2 character initials from a bot name */
function initials(name: string): string {
  const words = name.split(/[\s\-_]+/).filter(Boolean)
  if (words.length >= 2) {
    return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

/**
 * Generate a deterministic 64×64 SVG avatar for the given bot name.
 * The hue is derived from the name via djb2 so the same name always
 * produces the same colour.
 */
export function generateBotIcon(name: string): string {
  const hue = djb2(name) % 360
  const fill = `hsl(${hue}, 65%, 50%)`
  const stroke = `hsl(${hue}, 65%, 35%)`
  const label = initials(name)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">`,
    `  <title>${label}</title>`,
    `  <circle cx="32" cy="32" r="30" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`,
    `  <text x="32" y="32" dy="0.35em" text-anchor="middle"`,
    `        font-family="system-ui,sans-serif" font-size="24" font-weight="600"`,
    `        fill="white">${label}</text>`,
    `</svg>`,
  ].join('\n')
}
