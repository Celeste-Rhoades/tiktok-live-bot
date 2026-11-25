import sharp from "sharp";

// Hot pink, cyan, neon green, left to right
const GRADIENT = ["#FF2E97", "#00FFFF", "#39FF14"];

// Biggest the image gets before the frame is added; keeps uploads small
const MAX_SIZE = 600;

// Space around the image for the glow to spread into
const PADDING = 34;

// Thickness of the solid gradient border
const RING = 5;

const DOWNLOAD_TIMEOUT_MS = 10_000;

// The frame is drawn as SVG so sharp can render the gradient and blur with a see-through background
function glowSvg(width: number, height: number): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width + PADDING * 2}" height="${height + PADDING * 2}">
  <defs>
    <linearGradient id="gradient" x1="0" y1="0" x2="1" y2="0.35">
      <stop offset="0" stop-color="${GRADIENT[0]}"/>
      <stop offset="0.5" stop-color="${GRADIENT[1]}"/>
      <stop offset="1" stop-color="${GRADIENT[2]}"/>
    </linearGradient>
    <filter id="glow" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur stdDeviation="10"/>
    </filter>
  </defs>
  <rect x="${PADDING - 10}" y="${PADDING - 10}" width="${width + 20}" height="${height + 20}" fill="url(#gradient)" filter="url(#glow)" opacity="0.85"/>
  <rect x="${PADDING - RING}" y="${PADDING - RING}" width="${width + RING * 2}" height="${height + RING * 2}" fill="url(#gradient)"/>
</svg>`);
}

// Returns the framed image, or null so the alert can fall back to the plain image
export async function addGlowFrame(imageUrl: string): Promise<Buffer | null> {
  try {
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const original = Buffer.from(await response.arrayBuffer());

    const { data: image, info } = await sharp(original)
      .resize({
        width: MAX_SIZE,
        height: MAX_SIZE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer({ resolveWithObject: true });

    return await sharp(glowSvg(info.width, info.height))
      .composite([{ input: image, left: PADDING, top: PADDING }])
      .png()
      .toBuffer();
  } catch (error) {
    console.warn("Couldn't add the glow frame, using the plain image:", error);
    return null;
  }
}
