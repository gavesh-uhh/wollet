export const CARD_LOGOS = [
  { id: "seylan", name: "Seylan", issuer: "Seylan Bank", src: "/logos/seylan.png" },
  { id: "boc", name: "BOC", issuer: "Bank of Ceylon", src: "/logos/boc.svg" },
  { id: "chase", name: "Chase", issuer: "Chase", src: "/logos/chase.svg" },
] as const;

/** Only bundled assets and locally rasterized images can become card logos. */
export function getCardLogo(value?: string): { name: string; src: string; kind?: "registry" } | null {
  const logo = CARD_LOGOS.find(logo => logo.id === value);
  if (logo) return logo;
  const registry = value?.match(/^registry:([a-z0-9_-]{1,100})#([^#]{1,400})$/);
  if (registry) {
    try {
      const name = decodeURIComponent(registry[2]);
      if (!name.trim() || name.length > 100) return null;
      return { name, src: `/logos/registry/${registry[1]}.svg`, kind: "registry" };
    } catch { return null; }
  }
  if (value && value.length <= 250_000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)) {
    return { name: "Custom logo", src: value };
  }
  return null;
}

export interface LogoRegistryEntry {
  id: string;
  name: string;
  src: string;
  issuer?: string;
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** Search locally: no bank names or search terms are sent to a logo provider. */
export function searchCardLogos(entries: readonly LogoRegistryEntry[], query: string): LogoRegistryEntry[] {
  const needle = normalizeSearch(query);
  if (!needle) return [...entries];
  return entries.filter(entry => normalizeSearch(entry.name).includes(needle) ||
    normalizeSearch(entry.issuer || "").includes(needle) || normalizeSearch(entry.id.split("#")[0].replace(/^registry:/, "")).includes(needle));
}

export async function prepareRegistryLogo(value: string): Promise<void> {
  const logo = getCardLogo(value);
  if (logo?.kind !== "registry") throw new Error("Choose a logo from the registry.");
  let response: Response;
  try { response = await fetch(logo.src); }
  catch { throw new Error("This logo isn't available offline yet. Connect and try again."); }
  if (!response.ok) throw new Error("Could not load this logo. Try another, or use your own image.");
  // Keep selected logos across app updates, even on the first visit before a
  // service worker takes control. Public brand artwork contains no wallet data.
  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open("wollet-selected-logos-v1");
      await cache.put(logo.src, response);
    } catch { throw new Error("Could not keep this logo offline. Free some browser storage and try again."); }
  }
}

export async function readCardLogo(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp", "image/avif"].includes(file.type)) {
    throw new Error("Choose a PNG, JPG, WebP, or AVIF image.");
  }
  if (file.size > 10 * 1024 * 1024) throw new Error("Choose a logo smaller than 10 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not open this image. Try another logo."));
      image.src = url;
    });
    const scale = Math.min(1, 360 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the logo.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL("image/png");
    if (!getCardLogo(result)) throw new Error("This logo is too detailed. Try a smaller image.");
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}
