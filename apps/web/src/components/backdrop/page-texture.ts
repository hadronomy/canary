import type { Gpu } from 'vgpu';

import { BOE } from '~/components/backdrop/boe';

const WIDTH = 2048;
const HEIGHT = 3072;
const MIPS = 7;
const COLUMNS = 3;
const SIZE = 15; // body size, texture pixels
const LEAD = 1.52;
const GUTTER = 44;
// Half a gutter at each edge, so the two halves meet as one full gutter when
// the sampler wraps the page horizontally and the seam disappears.
const MARGIN = GUTTER / 2;

/**
 * Sets the real consolidated text of Ley 39/2015 into a columned page and hands
 * it back as a mipmapped GPU texture.
 *
 * The mip chain is the point, not an optimisation. Matryoshka embeddings work
 * because the coarse vector is a prefix of the fine one, and a mip pyramid is
 * the same idea in pixels: every level is a correctly filtered prefix of the
 * one below. Sampling it by LOD gives the backdrop genuine nested resolutions
 * of genuine type, instead of a procedural texture pretending to be text.
 */
async function pageTexture(gpu: Gpu) {
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context for the page texture');

  // The face has to be resident before the first measureText, or the layout is
  // computed against a fallback and then drawn with something else.
  await document.fonts.load(`${SIZE}px Erode`).catch(() => []);

  typeset(ctx);

  const tex = gpu.device.createTexture({
    label: 'boe-page',
    size: [WIDTH, HEIGHT],
    format: 'rgba8unorm',
    mipLevelCount: MIPS,
    usage: ['texture_binding', 'copy_dst', 'render_attachment'],
  });

  // Each level is resized from the full-resolution page rather than from the
  // level above, so seven successive halvings do not compound their own
  // filtering error into mush.
  for (let i = 0; i < MIPS; i++) {
    const w = Math.max(1, WIDTH >> i);
    const h = Math.max(1, HEIGHT >> i);
    const bitmap = await createImageBitmap(canvas, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: 'high',
    });
    gpu.device.gpu.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: tex.gpu, mipLevel: i },
      [w, h],
    );
    bitmap.close();
  }

  return tex;
}

function typeset(ctx: OffscreenCanvasRenderingContext2D) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textBaseline = 'alphabetic';

  const measure = (WIDTH - MARGIN * 2 - GUTTER * (COLUMNS - 1)) / COLUMNS;
  const lead = SIZE * LEAD;
  let col = 0;
  let y = MARGIN + SIZE;
  let at = 0;

  // Column rules, set first so the type sits over them. The rule at i = 0 sits
  // on the wrap seam, which is what keeps the repeat from reading as an edge.
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  for (let i = 0; i < COLUMNS; i++) {
    ctx.fillRect(Math.round(i * (measure + GUTTER)), 0, 1, HEIGHT);
  }

  function left() {
    return MARGIN + col * (measure + GUTTER);
  }

  function next(step: number) {
    y += step;
    if (y > HEIGHT - MARGIN) {
      col += 1;
      y = MARGIN + SIZE;
    }
    return col < COLUMNS;
  }

  // The text is shorter than the page, so it runs round again rather than
  // leaving a column empty. Nobody reads a backdrop end to end.
  while (col < COLUMNS) {
    const block = BOE[at % BOE.length];
    if (!block) break;
    at += 1;

    if (block.k === 'cap' || block.k === 'capt') {
      const caps = block.k === 'cap';
      if (!next(lead * (caps ? 1.6 : 0.4))) break;
      ctx.font = `${caps ? 600 : 400} ${SIZE * (caps ? 0.86 : 1)}px Erode, Georgia, serif`;
      ctx.fillStyle = caps ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.78)';
      const text = caps ? space(block.t) : block.t;
      ctx.fillText(text, left() + (measure - ctx.measureText(text).width) / 2, y);
      if (!next(lead)) break;
      continue;
    }

    if (block.k === 'art') {
      if (!next(lead * 0.9)) break;
      ctx.font = `600 ${SIZE}px Erode, Georgia, serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      for (const line of wrap(ctx, block.t, measure)) {
        ctx.fillText(line, left(), y);
        if (!next(lead)) return;
      }
      continue;
    }

    ctx.font = `400 ${SIZE}px Erode, Georgia, serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.80)';
    const indent = block.k === 'sub' ? SIZE * 1.4 : 0;
    const lines = wrap(ctx, block.t, measure - indent);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      // Every line but the last of a paragraph is justified to the measure.
      if (i < lines.length - 1) justify(ctx, line, left() + indent, y, measure - indent);
      else ctx.fillText(line, left() + indent, y);
      if (!next(lead)) return;
    }
  }
}

function wrap(ctx: OffscreenCanvasRenderingContext2D, text: string, measure: number) {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > measure) {
      out.push(line);
      line = word;
      continue;
    }
    line = test;
  }
  if (line) out.push(line);
  return out;
}

/** Spread a line to the full measure by growing its word spaces, the way a
 *  justified column actually sets. */
function justify(
  ctx: OffscreenCanvasRenderingContext2D,
  line: string,
  x: number,
  y: number,
  measure: number,
) {
  const words = line.split(' ');
  if (words.length < 2) {
    ctx.fillText(line, x, y);
    return;
  }
  const ink = words.reduce((sum, w) => sum + ctx.measureText(w).width, 0);
  const gap = (measure - ink) / (words.length - 1);
  // A line that would need absurd spacing is set flush instead of torn apart.
  if (gap > SIZE * 1.4) {
    ctx.fillText(line, x, y);
    return;
  }
  let cursor = x;
  for (const word of words) {
    ctx.fillText(word, cursor, y);
    cursor += ctx.measureText(word).width + gap;
  }
}

/** Letterspacing for the chapter lines, which the gazette sets in caps. */
function space(text: string) {
  return text.split('').join(' ');
}

export { pageTexture };
