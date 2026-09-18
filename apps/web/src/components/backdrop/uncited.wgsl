import { bayer, quantise, grain } from "./ink.wgsl";
import { hash2 } from "@vgpu/wgsl-std/hash";

// UNCITED — a reference nothing resolves to.
//
// Norms cite each other, so the corpus is a graph before it is a list. This
// draws that graph: a node per cell of a jittered lattice, edges to the
// neighbours right and below. One node is missing, and the edges that would
// have reached it stop short in open space.
//
// That is what a broken citation actually looks like from inside the model —
// not an empty page, but several live references pointing at nothing. The
// absence is local and specific rather than a hole punched in the middle,
// which is the whole difference between this and the empty-set treatment.
//
// Node positions come from a hash, so there is no simulation, no buffers and
// nothing to step. Deterministic, and the same every frame except for the
// drift.

struct Params {
  texel: vec2f,
  focus: vec2f, // 0..1 viewport position of the vacancy
  time: f32,
  amp: f32,     // 0..1, lifts the graph
}

@group(0) @binding(0) var<uniform> params: Params;

const CELL = 120.0;  // lattice pitch, device pixels
const STOP = 0.62;   // how far along a dangling edge the line gives up

// Where the node in this cell sits. Jittered off the lattice so the graph never
// reads as a grid.
fn node(c: vec2f, time: f32) -> vec2f {
  let h = hash2(c * 1.7 + 4.2);
  // Each node breathes on its own phase — enough to be alive, not enough to
  // look like it is being simulated.
  let sway = vec2f(sin(time * 0.21 + h.x * 6.28), cos(time * 0.17 + h.y * 6.28)) * 0.035;
  return c + vec2f(0.22, 0.22) + h * 0.56 + sway;
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

  // Work in lattice units so every distance below is in cells.
  let p = px / CELL;
  let base = floor(p);

  // The node that is not there. Placed by the layout rather than fixed to the
  // middle, so the vacancy and the dangling edges never end up underneath the
  // sentence explaining them.
  let gone = floor((params.focus * res) / CELL);

  // One pixel, in lattice units — keeps strokes a constant weight at any DPR.
  let hair = 1.0 / CELL;

  var line = 0.0;
  var dot = 0.0;

  for (var i = -1; i <= 1; i = i + 1) {
    for (var j = -1; j <= 1; j = j + 1) {
      let c = base + vec2f(f32(i), f32(j));
      let a = node(c, params.time);

      // A node is drawn unless it is the one that is missing.
      if (!(c.x == gone.x && c.y == gone.y)) {
        dot = max(dot, 1.0 - smoothstep(hair * 1.2, hair * 3.0, length(p - a)));
      }

      // Two edges per cell — right and below — so each edge is drawn once.
      for (var k = 0; k < 2; k = k + 1) {
        let step = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), k == 0);
        let d = c + step;
        var b = node(d, params.time);

        let dangling = (d.x == gone.x && d.y == gone.y);
        let orphaned = (c.x == gone.x && c.y == gone.y);
        if (dangling || orphaned) {
          // The reference is live, so the edge is drawn — it just has nowhere
          // to land, and gives up before it gets there.
          if (dangling) {
            b = a + (b - a) * STOP;
          } else {
            let keep = b + (a - b) * STOP;
            line = max(line, 1.0 - smoothstep(hair * 0.5, hair * 1.6, segment(p, b, keep)));
            continue;
          }
        }

        line = max(line, 1.0 - smoothstep(hair * 0.5, hair * 1.6, segment(p, a, b)));
      }
    }
  }

  // The vacancy, marked the way a missing entry is marked in an index: a small
  // open square where the node should have been.
  let slot = node(gone, params.time);
  let box = abs(p - slot);
  let ring = max(box.x, box.y);
  let mark = (1.0 - smoothstep(hair * 0.5, hair * 1.6, abs(ring - 0.11)))
    * step(min(box.x, box.y), 0.11);

  // Fade toward the frame so the graph belongs to the page rather than ending
  // at its edges.
  let edge = smoothstep(0.0, 0.30, uv.x) * smoothstep(1.0, 0.70, uv.x)
    * smoothstep(0.0, 0.16, uv.y) * smoothstep(1.0, 0.84, uv.y);

  let lift = 0.5 + params.amp * 0.5;
  let energy = quantise(
    clamp(line * 0.34 + dot * 0.85, 0.0, 1.0) * edge * lift + mark * 0.55,
    5.0,
    bayer(vec2u(px), 2u),
  );

  var color = vec3f(energy * 0.42);
  color += vec3f(grain(px, params.time) * 0.010);
  return vec4f(color, 1.0);
}
