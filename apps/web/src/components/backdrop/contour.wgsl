// Drawing a scalar field as its own contour lines.
//
// Shared by every backdrop that reads the corpus as a chart rather than as a
// texture. The whole job is keeping a hairline one width wide wherever it lands,
// and knowing when to stop drawing.

const TAU = 6.2831853;

/// A contour hairline through `phase`, anti-aliased in screen space.
///
/// `grad` must be `fwidth(phase)` — the phase's own screen gradient, taken in
/// uniform control flow. Dividing by it is what holds the line to one width
/// everywhere: without it, lines thin to nothing exactly where the field
/// steepens, which is where the drawing has something to say.
///
/// Returns 0 where contours crowd past roughly one per pixel. There is no
/// drawing left to resolve there, only aliasing, and fading out reads as the
/// field going glassy — which is true.
export fn hairline(phase: f32, grad: f32) -> f32 {
  let reach = abs(fract(phase) - 0.5) / max(grad, 1e-4);
  let solid = 1.0 - smoothstep(0.0, 1.0, grad * 1.6);
  return (1.0 - smoothstep(0.35, 1.25, reach)) * solid;
}

/// A luminance wave travelling downstream, in [0, 1].
///
/// Steady flow has steady streamlines: the lines themselves must not move, or a
/// 1px feature crosses several pixels a frame and strobes rather than drifts. So
/// the lines stay put and the *brightness* travels along them. `bend` leans the
/// wavefront onto the flow so it arrives as a curved front rather than a
/// vertical bar wiping across the page.
export fn sweep(px: vec2f, psi: f32, time: f32, wavelength: f32, speed: f32, bend: f32) -> f32 {
  return sin(((px.x - time * speed) / wavelength) * TAU + psi * bend) * 0.5 + 0.5;
}
