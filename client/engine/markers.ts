/**
 * @file Quest markers drawn above NPCs: a gold "!" (a quest to take) and a
 * silver-blue "?" (a quest to hand in, or someone to talk to). They are
 * generated as small SVG images, rasterised once by the browser.
 */

/** Marker size in pixels at zoom 1. */
export const MARKER_SIZE = 22;

function badge(symbol: string, fill: string, stroke: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
<path d="M22 3 C33 3 40 10 40 20 C40 30 33 36 26 37 L22 42 L18 37 C11 36 4 30 4 20 C4 10 11 3 22 3 Z" fill="${fill}" stroke="#20160a" stroke-width="3"/>
<path d="M12 12 C15 8 20 7 24 7" fill="none" stroke="#ffffff" stroke-opacity="0.6" stroke-width="3" stroke-linecap="round"/>
<text x="22" y="30" text-anchor="middle" font-family="Verdana, Arial, sans-serif" font-weight="900" font-size="24" fill="#ffffff" stroke="${stroke}" stroke-width="2" paint-order="stroke">${symbol}</text>
</svg>`;
}

function load(svg: string): HTMLImageElement {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return image;
}

let images: HTMLImageElement[] | null = null;

/**
 * Image of a marker (1 = "!", 2 = "?"), or `null` for no marker / not loaded yet.
 * @param marker - Marker value from the event view.
 */
export function markerImage(marker: number): HTMLImageElement | null {
  images ??= [load(badge('!', '#f2b626', '#7a4a00')), load(badge('?', '#6fb6f2', '#1c4a7a'))];
  const image = images[marker - 1];
  return image && image.complete && image.naturalWidth > 0 ? image : null;
}
