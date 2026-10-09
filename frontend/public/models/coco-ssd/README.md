These are the official TensorFlow.js COCO SSD `lite_mobilenet_v2` inference
assets, distributed under Apache 2.0. Their source, sizes, Google object
checksums, and SHA-256 checksums are recorded in `provenance.json`.

The upstream integration is maintained at
https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd.
The original assets are served by Google at the source recorded in provenance.

The application serves these assets from its own origin and performs inference
in the browser. Models can detect supported visible objects, including the COCO
`cell phone` class. Detection cannot establish that a person is using the object
or that misconduct has occurred. Small objects, poor light, occlusion and unusual
camera angles affect accuracy.

To restore the original files, run `npm run setup:vision` in `frontend`. The
download command requires Node, curl and access to `storage.googleapis.com`.
It preserves HTTPS verification and verifies Google's published object checksum.
