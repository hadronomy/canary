import { simplex2d } from "@vgpu/wgsl-std/noise/simplex";

// FIELD — the static half of the wake, solved once.
//
// The conformal pullback, the jet and the body are all pure functions of screen
// position: they depend on where the text block is, and on nothing else. Solving
// them per frame was costing roughly 2.8 billion complex divisions a frame at
// 2x on a 1440-wide window, which is about fifteen frames a second on a desktop
// GPU and unusable anywhere else.
//
// So this pass runs once, when the block moves or the surface resizes, and
// writes the answer into a texture. What is left for the live pass is a texture
// fetch.
//
// Output: xy = velocity, z = streamfunction, w = distance outside the body.

struct Params {
  texel: vec2f,
  body: vec2f,   // half-width and half-height of the block, flow units
  centre: vec2f, // 0..1 position of the block within the section
  time: f32,
  amp: f32,
}

@group(0) @binding(0) var<uniform> params: Params;

const SPAN = 2.4;
const NEWTON = 4;
const SQUARE = 0.13;

fn cmul(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

fn cdiv(a: vec2f, b: vec2f) -> vec2f {
  let d = max(dot(b, b), 1e-9);
  return vec2f(dot(a, b), a.y * b.x - a.x * b.y) / d;
}

/// Circle radius and the two map coefficients that bend it into this block.
///
/// Tracing |w| = a gives half-extents A = a + c2 + c4 and B = a - c2 + c4, so
/// the measured block goes straight in. The four-fold term has to be negative:
/// positive pulls the diagonals in and gives a diamond, negative pushes them out
/// and squares the circle.
fn shape(body: vec2f) -> vec3f {
  let sum = (body.x + body.y) * 0.5;
  let g = -SQUARE * sum;
  let a = max(sum - g, 1e-3);
  let b2 = (body.x - body.y) * 0.5;
  return vec3f(a, b2 * a, g * a * a * a);
}

fn mapped(w: vec2f, c2: f32, c4: f32) -> vec2f {
  let w2 = cmul(w, w);
  return w + cdiv(vec2f(c2, 0.0), w) + cdiv(vec2f(c4, 0.0), cmul(w2, w));
}

fn derivative(w: vec2f, c2: f32, c4: f32) -> vec2f {
  let w2 = cmul(w, w);
  let w4 = cmul(w2, w2);
  return vec2f(1.0, 0.0) - cdiv(vec2f(c2, 0.0), w2) - cdiv(vec2f(3.0 * c4, 0.0), w4);
}

/// Pull a point back to the circle plane. Newton from w = z, which is close
/// everywhere outside the body because the map is a perturbation of the identity
/// that dies off as 1/w.
fn pullback(z: vec2f, a: f32, c2: f32, c4: f32) -> vec2f {
  var w = z;
  let r = length(w);
  if (r < a * 1.05) {
    w = w * (a * 1.05 / max(r, 1e-4));
  }
  for (var i = 0; i < NEWTON; i = i + 1) {
    w = w - cdiv(mapped(w, c2, c4) - z, derivative(w, c2, c4));
  }
  return w;
}

/// Half-width of the jet at this station: pinched on the way in, opening out
/// once it is past the body.
fn spread(x: f32) -> f32 {
  return mix(0.24, 1.9, smoothstep(-1.7, 2.1, x));
}

/// The streamfunction. Every line the current draws is a contour of this.
///
/// tanh(y/d) carries a fixed flux however wide it is, so pinching d speeds the
/// current up and opening it slows it down. Multiplying by the body factor
/// leaves it zero on |w| = a, so the body stays exactly impermeable.
///
/// The wander is baked in at a fixed phase rather than animated. It is what
/// keeps the streamlines organic instead of textbook-symmetrical, and it costs
/// nothing here because this pass does not run again.
fn stream(z: vec2f, a: f32, c2: f32, c4: f32) -> f32 {
  let w = pullback(z, a, c2, c4);
  let r2 = max(dot(w, w), 1e-5);
  let body = tanh(w.y / spread(w.x)) * (1.0 - a * a / r2);
  return body + simplex2d(z * 0.42) * 0.17;
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = 1.0 / params.texel;
  let aspect = res.x / res.y;
  let z = vec2f((uv.x - params.centre.x) * aspect, uv.y - params.centre.y) * SPAN;

  let form = shape(params.body);
  let a = form.x;
  let c2 = form.y;
  let c4 = form.z;

  // Velocity is the curl of the streamfunction: its gradient, turned a quarter
  // turn. Divergence-free whatever the streamfunction happens to be, so the jet
  // can be shaped freely without the current developing sinks.
  let e = 0.016;
  let psi = stream(z, a, c2, c4);
  let dx = stream(z + vec2f(e, 0.0), a, c2, c4) - psi;
  let dy = stream(z + vec2f(0.0, e), a, c2, c4) - psi;
  let v = vec2f(dy, -dx) / e;

  // Newton has nowhere to land inside the body, so it wanders there. Rather than
  // trusting the iteration, check the answer maps back to where it came from.
  let w = pullback(z, a, c2, c4);
  let residual = length(mapped(w, c2, c4) - z);
  let out = select(-1.0, length(w) - a, residual < 0.02);

  return vec4f(v, psi, out);
}
