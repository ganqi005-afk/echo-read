export interface ChunkOptions {
  maxWords?: number;
  minWords?: number;
}

const PRIMARY = /(?<=[,;:\u2014])\s+|\s+[\u2014-]\s+/;

const SECONDARY = [
  " and ", " but ", " which ", " that ", " because ",
  " while ", " when ", " if ", " although ", " though ", " so ",
];

export function countWords(text: string): number {
  return (text.match(/[A-Za-z0-9'\u2019-]+/g) ?? []).length;
}

export function splitChunks(sentence: string, options: ChunkOptions = {}): string[] {
  const maxWords = options.maxWords ?? 18;
  const minWords = options.minWords ?? 5;
  const text = sentence.trim();
  if (!text) return [];
  if (countWords(text) <= maxWords) return [text];

  const primary = text.split(PRIMARY).map((p) => p.trim()).filter(Boolean);
  const secondary = primary.flatMap((p) => splitLongPart(p, maxWords));
  return mergeShortParts(secondary, minWords);
}

function splitLongPart(part: string, maxWords: number): string[] {
  if (countWords(part) <= maxWords) return [part];

  const target = Math.floor(part.length / 2);
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const marker of SECONDARY) {
    let from = 0;
    for (;;) {
      const index = part.indexOf(marker, from);
      if (index < 0) break;
      const distance = Math.abs(index - target);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
      from = index + 1;
    }
  }

  if (bestIndex <= 0) return [part];

  const left = part.slice(0, bestIndex).trim();
  const right = part.slice(bestIndex).trim();
  if (!left || !right) return [part];

  return [...splitLongPart(left, maxWords), ...splitLongPart(right, maxWords)];
}

function mergeShortParts(parts: string[], minWords: number): string[] {
  const out: string[] = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    if (prev !== undefined && countWords(part) < minWords) {
      out[out.length - 1] = `${prev} ${part}`;
    } else {
      out.push(part);
    }
  }
  if (out.length > 1 && countWords(out[0]) < minWords) {
    out[1] = `${out[0]} ${out[1]}`;
    out.shift();
  }
  return out;
}
