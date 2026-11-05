# Instrument studies: research and rendering principles

Research preceded implementation. These are mood/material references, not graphics to reproduce. Reference photographs are for this local research board only; no reference image is loaded by the studies or included in their rendering bundles.

## Suspended core

[NASA: Four Gyroscopes, Gravity Probe B](https://www.nasa.gov/image-article/four-gyroscopes/). Reference image credit: Stanford University/Barron Storey. The niobium-coated quartz rotor and nested housing provide a useful vocabulary: a precisely finished dark mass suspended inside a fine supporting assembly, separated surfaces, and small clearances that establish real depth. The illustration's labels, callouts and exploded layout are not adopted.

Implementation: three-dimensional graphite/titanium plates with hairline seams, fine internal gimbals, six small response-light cuts, and a smoked optical shell with restrained grazing reflections. No bloom pass. Listening gives shallow, bounded parallax (under two degrees per axis); thinking indexes the inner assembly then visibly holds; speaking produces small axial movement and light response from a fixed phrase envelope. The shell never continuously spins.

## Field distortion

[NASA Scientific Visualization Studio: Black Hole with Accretion Disk Visualization](https://svs.gsfc.nasa.gov/14619/). Use only the optical principle: a volume can become legible by bending light behind it, with asymmetric highlights rather than a painted luminous surface. Do not copy the black hole, accretion disk, stars or rainbow diagnostic view. [NASA's explanatory article](https://www.nasa.gov/universe/nasa-visualization-shows-a-black-holes-warped-world/) supplied context.

Implementation: a custom WebGL shader actually samples the existing baseline background canvas, displaces its UVs across an analytic spherical normal field, and reconstructs the existing crimson CSS wash within the lens. Two restrained studio-strip reflections reveal curvature. Listening has minute refractive movement; thinking changes the optical axis and holds; speaking changes distortion strength and the reflected contours. This is screen-space optical art direction, not physically accurate gravitational lensing, spectral dispersion or full path-traced refraction. The live background remains the baseline background, not an invented particle layer. Its canvas texture is reallocated on resize, and waits for a real background frame before becoming visible.

## Kinetic aperture

[ZEISS Supreme Prime](https://www.zeiss.com/photonics-and-optics/us/cinematography/lenses/supreme-prime-lenses.html). Use the contrast between blackened metal, restrained machined bevels, tiny repeatable mechanical details and recessed glass. The manufacturer's descriptions of smooth focus rotation, contained flare and gentle sharpness support controlled movement and light rather than spectacle. Product logos, numerals, markings and lens silhouette are not copied.

Implementation: twelve articulated, overlapping three-dimensional blades with thickness, concentric barrel profiles, fine edge teeth, deeply recessed optical baffles and six short inset light slots. Listening holds an open aperture with tiny parallax; thinking closes the aperture and counter-indexes the blade carriage and trim, then holds; speaking opens and relaxes the blades in response to a deterministic phrase envelope. The assembly does not rotate continuously.

## Shared motion and boundaries

- Connecting settles into alignment once; listening stays quiet rather than pulsing like speech.
- Thinking moves for a short interval, holds, returns and holds: a six-second bounded cycle, not a spinner.
- Speaking follows seven fixed overlapping syllable envelopes over 6.8 seconds, including rests.
- Muted and ended have static geometry and restrained light. Refraction can still transmit the existing moving background in normal-motion mode.
- Reduced motion presents a distinct static pose for each existing state, with unchanged readable state labels. There is no extra animation switch in the product UI.
- The existing background reads the OS reduced-motion preference at mount; live preference changes stop the new orb, but the inherited background's preference behavior is unchanged.

Available tools: installed Three.js 0.186.1, esbuild 0.28.2 and Playwright/Chromium; custom geometry and shaders, procedural local studio lighting, no dependency installation or external runtime assets. The available tool registry exposed no matching UI/design skill. Territory Studio's Ex_Machina page was also consulted for the restraint of credible near-future design, but none of its interface graphics or layouts was adopted.
