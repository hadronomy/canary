import { bayer, grain, quantise } from "./ink.wgsl";
import { fbmSimplex3d } from "@vgpu/wgsl-std/noise/simplex";
import { hash2 } from "@vgpu/wgsl-std/hash";

// PROMPT — the page before anything has been asked of it.
//
// A corpus as a night sky: documents as stars, citations as the lines between
// them. Far from the composer the stars are scattered and nothing links them.
// Near it they brighten and the links resolve. That is the claim the product
// makes — scattered in, connected out — and `uncited.wgsl` already draws the
// other half of it, so this is the same corpus seen before anything is asked
// rather than a second visual language.
//
// Four layers, in this order, and the order is the design:
//
//   1. A nebula. Domain-warped fbm (Quilez), very dim and very wide. It is not
//      really there to be seen — it is the density function the stars are
//      placed against, which is what keeps them from reading as a grid.
//   2. Stars on a jittered lattice, magnitude from a hash raised to a power so
//      a few are bright and most are faint. A uniform field of equal dots is a
//      texture; an uneven one is a sky.
//   3. Links between neighbouring stars, and this is where the taste goes. A
//      line to every neighbour is a wireframe. A line only where both ends are
//      bright and the gap is short is a constellation — something picked out
//      rather than something meshed.
//   4. The halftone screen, which is what turns all of it into print.
//
// Everything is solved once per screen cell, at its centre. Sampling per pixel
// leaves full-resolution detail under the dots, and that detail is what reads
// as noise rather than as a picture.
//
// Decorative only: the screen is complete and legible with this absent, and it
// is absent on every device without WebGPU or with reduced motion asked for.

struct Params {
  texel: vec2f,
  quiet: vec4f,  // x, y, w, h in viewport fractions — where the composer sits
  focus: vec2f,  // 0..1 viewport position the field organises toward
  time: f32,
  amp: f32,      // 0..1, widens the connected region while the composer holds focus
  pulse: f32,    // 0..1, decaying kick per keystroke
  glitch: f32,   // 0..1, scatters the links when a send is rejected
  launch: f32,   // 0..1, a sent message travelling out through the corpus
  berth: vec4f,  // x, y, w, h — the composer itself, measured every frame
  spot: vec2f,   // where the current launch left from
  dock: f32,     // 0 on the new-thread screen, 1 in a thread, eased between
  paper: f32,    // 1 in light mode: the sky is printed in ink rather than lit
}

@group(0) @binding(0) var<uniform> params: Params;

// Violet is the one hue the app spends. It is mixed into the ink rather than
// laid over it as a wash, so it arrives as the colour of the mark instead of as
// a filter sitting on top of one.
const TINT = vec3f(0.55, 0.40, 1.0);

// The ink the light-mode sky is printed in: a violet-slate that reads as the
// same hue as TINT once it is dots on paper, and deepens toward the composer
// the way the lit sky brightens there.
const INK = vec3f(0.30, 0.27, 0.40);
const DEEP = vec3f(0.33, 0.20, 0.72);

// Steps across the whole 0..1 output range. Few enough that the screen has to
// open and close to carry a gradient, which is the whole point of it.
const STEPS = 9.0;

// Lattice pitch in device pixels. Wide enough that a star is an event rather
// than a texel, tight enough that the 3x3 search still reaches its neighbours.
const CELL = 148.0;

/// How many device pixels across one cell of the screen.
///
/// Derived from the surface width rather than fixed. A constant in device
/// pixels halves the pitch on a 2x display, which is how an earlier pass at
/// this ended up screening at one device pixel and disappearing into a flat
/// panel on exactly the machines it was being looked at on.
fn pitch(res: vec2f) -> f32 {
  return max(3.0, round(res.x / 400.0));
}

/// One octave stack, at a point and a moment.
fn layer(p: vec2f, t: f32) -> f32 {
  return fbmSimplex3d(vec3f(p, t), 3, 2.13, 0.5);
}

/// Where this cell's star sits, in lattice units.
///
/// Jittered off the lattice so the sky never reads as a grid, and swaying on
/// its own phase — enough to be alive, not enough to look simulated.
fn star(c: vec2f, time: f32) -> vec2f {
  let h = hash2(c * 1.7 + 4.2);
  let sway = vec2f(sin(time * 0.13 + h.x * 6.28), cos(time * 0.11 + h.y * 6.28)) * 0.03;
  return c + vec2f(0.22, 0.22) + h * 0.56 + sway;
}

/// How bright this cell's star is, in [0, 1].
///
/// Squaring is what makes it a sky. Flat random gives every star the same
/// weight and the lattice shows through; skewed toward the dim end, most cells
/// hold something faint and the few that survive read as actual stars. A
/// fourth power skews so hard that nothing survives and the sky goes empty.
fn mag(c: vec2f) -> f32 {
  let h = hash2(c * 3.1 - 1.7).x;
  return h * h;
}

fn segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * t);
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = 1.0 / params.texel;
  let px = uv * res;
  let aspect = res.x / res.y;

  // Everything below is solved at the centre of the screen cell, not at this
  // pixel, so a whole cell shares one value and can carry one dot.
  let size = pitch(res);
  let cell = floor(px / size);
  let at = (cell + 0.5) * size * params.texel;
  let q = vec2f(at.x * aspect, at.y);

  // How far the organising reaches. Wide on purpose — the sky is the page, not
  // a pool in the middle of it. The keystroke kick is small: it should register
  // as the field noticing, not as the page lurching.
  let reach = (1.05 + params.amp * 0.18 + params.pulse * 0.04) * (1.0 - params.glitch * 0.3);

  let r = length((at - params.focus) * vec2f(aspect, 1.0)) / reach;

  // A long, shallow falloff rather than a tight pool. The exponent is low so
  // the sky still carries light out at the corners instead of ending in a ring.
  let glow = pow(clamp(1.0 - r, 0.0, 1.0), 1.5);

  // How resolved things are here. This is what gathers the constellation
  // around the composer and lets it fall apart at the edges.
  let bound = clamp(1.0 - r * 0.85, 0.0, 1.0) * (1.0 - params.glitch * 0.7);

  // LAYER 1 — the nebula, and the density the stars are placed against. One
  // clock, slow: layers on separate clocks reorganise continuously, which is
  // motion without composition.
  let t = params.time * 0.012;
  let base = q * 0.7;
  let w = vec2f(layer(base, t), layer(base + vec2f(5.2, 1.3), t));
  let cloud = layer(base + 2.0 * w + vec2f(1.7, 9.2), t) * 0.5 + 0.5;

  // LAYERS 2 AND 3 — stars and the lines between them, over the 3x3
  // neighbourhood of the lattice cell this screen cell falls in.
  let p = px / CELL;
  let home = floor(p);
  let hair = 1.0 / CELL;

  var lit = 0.0;
  var link = 0.0;

  for (var i = -1; i <= 1; i = i + 1) {
    for (var j = -1; j <= 1; j = j + 1) {
      let c = home + vec2f(f32(i), f32(j));
      let a = star(c, params.time);
      let ma = mag(c);

      // The nebula gates the field, hard. Stars thin out to almost nothing
      // where the cloud is thin, so they arrive in drifts with clearings
      // between them rather than scattered evenly across the page.
      let live = ma * (0.18 + 0.82 * smoothstep(0.2, 0.85, cloud));

      // Bright stars are wider as well as brighter, which is how magnitude
      // actually reads on paper — and the screen needs a couple of cells of
      // width before it has anything to print.
      let halo = hair * (2.0 + live * 11.0);
      lit = max(lit, live * (1.0 - smoothstep(hair * 0.8, halo, length(p - a))));

      // Two edges per cell — right and below — so each edge is drawn once.
      for (var k = 0; k < 2; k = k + 1) {
        let d = c + select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), k == 0);
        let b = star(d, params.time);
        let mb = mag(d);

        // The selective bit, and the whole difference between a constellation
        // and a mesh. Both ends have to be worth joining, and the gap has to be
        // short — a line drawn to every neighbour is a wireframe of the
        // lattice, which is exactly the grid the jitter exists to hide.
        let pair = min(ma, mb);
        let span = 1.0 - smoothstep(0.95, 1.6, length(b - a));
        let worth = smoothstep(0.2, 0.55, pair) * span;

        if (worth > 0.001) {
          link = max(
            link,
            worth * (1.0 - smoothstep(hair * 0.7, hair * 2.8, segment(p, a, b))),
          );
        }
      }
    }
  }

  // LAUNCH — the moment a message goes out. A front leaves the composer and
  // crosses the sky, and what it passes lights up: stars flare, and links join
  // up well past where the composer can normally reach, then let go again
  // behind it. It is the claim of the page played once — the question going
  // out into the corpus and the corpus answering — and it runs while the thread
  // is being made, so the wait has something to say.
  //
  // The front decelerates (a cubic ease-out on distance), which is how a ripple
  // reads; a constant-speed ring reads as a radar sweep. It fades as it goes,
  // so it thins out at the edges of the page instead of hitting them.
  let l = params.launch;
  let away = length((at - params.spot) * vec2f(aspect, 1.0));
  let front = (1.0 - pow(1.0 - l, 3.0)) * 1.5;
  let fade = pow(1.0 - l, 1.5) * step(0.0001, l);
  // Squared by hand: `pow` with a negative base is undefined in WGSL, and
  // behind the front the base is negative.
  let z = (away - front) / 0.1;
  let wave = exp(-z * z) * fade;
  let wake = (1.0 - smoothstep(front - 0.5, front, away)) * fade * 0.35;

  // DOCK — the same sky once a conversation has started. It does not go away:
  // it gathers around the composer and withdraws to the margins either side of
  // the conversation, so the page keeps its atmosphere and the text keeps a
  // clean column to be read in.
  //
  // Everything here follows the composer as it is measured this frame, so while
  // the composer travels down to its place the sky travels with it — there is
  // no second animation to keep in step with the first. The handover itself is
  // one number, eased once more here so both ends settle rather than stop.
  let e = smoothstep(0.0, 1.0, params.dock);
  let b = params.berth;

  // Distance from this cell to the composer's box, in page heights.
  let half = b.zw * 0.5;
  let past = max(abs(at - (b.xy + half)) - half, vec2f(0.0)) * vec2f(aspect, 1.0);
  let dist = length(past);

  // How far outside the conversation column this cell sits, as a fraction of
  // the margin actually available on that side, so the same shape fits any
  // panel width. The column is the composer's own width, which is the
  // transcript's.
  let west = max(b.x, 1e-3);
  let east = max(1.0 - (b.x + b.z), 1e-3);
  let side = smoothstep(0.0, 1.0, clamp(max((b.x - at.x) / west, (at.x - (b.x + b.z)) / east), 0.0, 1.0));

  // One light, and the composer is its source. It falls off with distance from
  // the composer's box, and only the reach of that falloff changes across the
  // page: short in the column, where it is a band about sixty pixels deep
  // hugging the box and the text stays clear, and long out in the margins,
  // where it climbs the sides and thins toward the top. The reach itself eases
  // from one to the other across the margin, which is what makes the edge
  // toward the text soft rather than drawn.
  //
  // Because the margins are the same falloff as the band, the bottom corners —
  // where the two meet — are one continuous shape: the light in the margins
  // reads as having spilled out of the composer, not as a second source.
  let spill = mix(0.07, 0.5, side);
  let light = exp(-dist / spill) * smoothstep(0.02, 0.22, at.y);

  // Once docked the composer is at the bottom of the page, and light that only
  // radiates from the field's focus leaves the margins dark however open they
  // are. So wherever this light falls becomes a place of attention in its own
  // right: the nebula lifts there and links resolve there, and the rest of the
  // field is masked away around it.
  let lift = e * light * 0.55;
  let near = max(glow, lift);
  let hold = max(bound, lift);
  let keep = mix(1.0, light, e) * mix(1.0, 0.9, e);

  // Links are bound to the composer, stars are not. The sky is there the whole
  // way out; what the composer does is draw the lines in.
  let tone = near * (0.05 + pow(cloud, 1.7) * 0.2) + lit * (0.5 + near * 0.5 + wave * 0.9)
    + link * (hold + wave * 1.4 + wake) * 0.42;

  // Ease proportionally to the region rather than by a fixed distance: a fixed
  // falloff wider than the region's half-width never reaches full clearing, so
  // the middle stays veiled and the edge still reads as a box. The vertical
  // falloff runs well past the region's own height for the same reason — the
  // composer is wide and short, and a proportional ease on a short axis is a
  // hard edge.
  let k = params.quiet;
  let room = smoothstep(0.0, k.z * 0.42, min(at.x - k.x, k.x + k.z - at.x))
    * smoothstep(0.0, k.w * 1.6, min(at.y - k.y, k.y + k.w - at.y));


  // Everything continuous happens first, and the quantising happens last.
  //
  // Screening the field and then multiplying by the falloff and the tint — both
  // smooth functions of position — reconstructs a continuous gradient out of
  // the steps and throws the screen away. It has to land on the values actually
  // written to the framebuffer.
  let value = clamp(tone * keep * (1.0 - room), 0.0, 1.0) * 0.62;

  // The matrix is read on the cell, so one cell of the screen carries one
  // threshold. Ordered rather than blue-noise-like: a scattered threshold hides
  // itself by design, and the job here is a pattern you can see.
  let d = bayer(vec2u(vec2i(cell) & vec2i(7)), 3u);

  // PAPER — the light-mode sky. Light on a light page is invisible, and a dark
  // sky on a light page is a black box with the heading lost in it. So the same
  // field is printed instead: what was brightness becomes ink coverage, and the
  // panel's own surface shows through as the paper. The canvas is premultiplied,
  // so coverage is the alpha and the ink is scaled by it.
  //
  // Coverage is screened as one value, not per channel, so every dot is the
  // same ink and only the screen opens and closes. The ramp is also reshaped:
  // on black the nebula floor is a dim haze, but in ink the same level prints a
  // dot in every other cell and the page turns to graph paper. Pushing the low
  // end down leaves the floor as sparse drifts, while stars and links, which sit
  // well up the ramp, keep their weight.
  if (params.paper > 0.5) {
    let cover = quantise(smoothstep(0.03, 0.7, value / 0.62) * 0.78, STEPS, d);
    let ink = mix(INK, DEEP, clamp(0.25 + near * 0.55 + wave * 0.4, 0.0, 1.0));
    return vec4f(ink * cover, cover);
  }

  var color = vec3f(value) * mix(vec3f(1.0), TINT, 0.5 + near * 0.3);

  // Grain on the pixel rather than the cell, and barely there. It is the only
  // thing in the image finer than a cell, which is what keeps the dots from
  // reading as a rendering resolution.
  color += vec3f(grain(px, params.time) * 0.004);

  // One threshold for all three channels. Per-channel thresholds screen the hue
  // as well as the level, which shows up as colour speckle on a tint this
  // saturated.
  return vec4f(
    quantise(color.r, STEPS, d),
    quantise(color.g, STEPS, d),
    quantise(color.b, STEPS, d),
    1.0,
  );
}
