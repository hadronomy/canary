import { hairline, sweep } from "./contour.wgsl";
import { bayer, quantise, grain } from "./ink.wgsl";

// WAKE · LENS — the absence has mass.
//
// A reference nothing resolves is not simply missing from a citation graph. Every
// document around it still points at it, so it carries the weight of everything
// that cites it and nothing that answers. This draws that literally: the corpus
// is the same contour field `silk` draws, and it is gravitationally lensed by the
// hole in the middle of it.
//
// Nothing here is raymarched. A real geodesic integration is hundreds of steps a
// pixel and would not hold thirty frames on a laptop, let alone a phone. But the
// lensing that reads as a black hole — light piling up into a ring, the field
// stretching tangentially, a shadow with a hard edge — is a deflection that falls
// off as one over radius, and that is one displaced texture fetch. The whole
// effect costs the same as `silk` plus a square root.
//
// So: sample the field at where the light *came from* rather than where it
// lands. Far out the deflection vanishes and this is exactly `silk`. Close in,
// the contours wrap the absence and pile into the photon ring.

struct Params {
  texel: vec2f,
  body: vec2f,   // half-width and half-height of the block, flow units
  centre: vec2f, // 0..1 position of the block within the section
  pull: vec2f,   // where the mass leans, section units; never the shadow
  time: f32,
  amp: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var weave: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

const SPAN = 2.4;    // flow units across one section height, as `field` sets it
const LINES = 92.0;  // contours across the streamfunction's range
const WAVE = 620.0;  // device pixels between wave crests, downstream
const SPEED = 54.0;  // device pixels a second the wave travels
const ROUND = 4.0;   // superellipse exponent; 4 tracks the block's squircle

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = 1.0 / params.texel;
  let px = uv * res;
  let aspect = res.x / res.y;

  // The horizon is the text block, not a circle, so the radial coordinate is a
  // superellipse: `k` is 1 on the block's own boundary and grows linearly
  // outward. Everything below is expressed in those units, which is what keeps
  // the ring hugging the type instead of floating around it.
  let half = max(params.body / SPAN, vec2f(1e-3, 1e-3));
  let p = vec2f((uv.x - params.centre.x) * aspect, uv.y - params.centre.y);
  let q = abs(p) / half;
  let k = pow(pow(q.x, ROUND) + pow(q.y, ROUND), 1.0 / ROUND);

  // The horizon is welded to `centre`, never to `pull`. The prepass carved the
  // flow void there and only re-solves on resize, so a shadow that tracked the
  // pointer would slide straight off the type it is supposed to be.
  //
  // What leans is the mass. Offsetting only the deflection centre throws the
  // wrap lopsided toward the pointer while the shadow stays exactly where the
  // text is — the field notices you, the hole does not wander.
  let g = p - vec2f(params.pull.x * aspect, params.pull.y);
  let gq = abs(g) / half;
  let gk = pow(pow(gq.x, ROUND) + pow(gq.y, ROUND), 1.0 / ROUND);

  // Deflection falls off as 1/k, which is the weak-field result and the reason
  // this is affordable. The floor keeps it finite crossing the horizon, where
  // the real answer diverges and there is nothing to draw anyway.
  let reach = (half.x + half.y) * 0.5;
  let bend = 1.15 * params.amp * reach / max(gk, 0.42);
  let dir = g / max(length(g), 1e-5);

  // Sample where the light came *from*: at radius k we are seeing the field that
  // actually lives further in. That inward pull is what compresses the contours
  // into the ring rather than merely bulging them.
  let source = uv - vec2f(dir.x / aspect, dir.y) * bend;
  let f = textureSampleLevel(weave, samp, clamp(source, vec2f(0.0), vec2f(1.0)), 0.0);
  let density = f.z;
  let psi = f.w;

  // Derivatives first, above every branch — `fwidth` is only defined where all
  // four pixels of the quad reached it. Taking them on the *lensed* phase is
  // what makes the hairlines stretch tangentially near the ring on their own:
  // the screen gradient already knows the field is being smeared there.
  let phase = psi * LINES;
  let grad = fwidth(phase);
  let edge = fwidth(k);

  // The shadow. Hard-edged by one pixel, because an event horizon is the one
  // boundary in physics that genuinely has no gradient.
  let shadow = smoothstep(0.0, edge * 1.5, k - 1.0);

  if (density <= 0.001 || shadow <= 0.001) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }

  let wave = 0.66 + 0.34 * sweep(px, psi, params.time, WAVE, SPEED, 2.1);
  let breath = 0.92 + 0.08 * sin(params.time * 0.22 + psi * 1.4);
  let alive = density * wave * breath;

  // The ring is not drawn. Putting a bright circle at some chosen radius is the
  // obvious move and it reads as exactly that — a circle pasted over the
  // picture. What makes a real Einstein ring is the background piling up where
  // the deflection gradient runs away, and that is measurable right here: it is
  // where the contours crowd past what a pixel can resolve, which is the same
  // place `hairline` gives up. So the light that the drawing loses is put back
  // as tone, and the ring appears on its own, hugging the shadow, bending where
  // the field bends.
  let ring = smoothstep(0.45, 1.5, grad);

  // One side brighter, the side the corpus arrives from. Beaming is the reason a
  // real ring is never even, and it is also what stops this reading as a drawn
  // circle sitting on top of the picture.
  let beam = 0.45 + 0.55 * smoothstep(-1.0, 1.0, -dir.x);

  var value = hairline(phase, grad) * alive * 0.72;
  value += ring * beam * alive * 0.62;
  value *= shadow;

  // Fine steps against a static threshold: kills the banding in the wave without
  // posterising the lines, and the ordered pattern never moves, so nothing
  // crawls between frames.
  value = quantise(clamp(value, 0.0, 1.0), 24.0, bayer(vec2u(px), 3u));

  value += grain(px, params.time) * 0.008;
  return vec4f(vec3f(max(value, 0.0)), 1.0);
}
