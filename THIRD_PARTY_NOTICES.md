# Third-party data and software

The code in this repository is MIT licensed (see `LICENSE`). The app is built
from data with their own licences:

## NeuroMechFly v2 body model (flygym)

* Source: https://github.com/NeLy-EPFL/flygym (`src/flygym/assets/model/neuromechfly`)
* Licence: Apache License 2.0
* Citation: Wang-Chen S., Stimpfling V. A., Lam T. K. C., Özdil P. G.,
  Genoud L., Hurtak F., Ramdya P. *NeuroMechFly v2: simulating embodied
  sensorimotor control in adult Drosophila.* Nature Methods (2024).
* `godot/assets/fly_rig_default.json` is derived from `rigging.yaml` and the
  neutral pose files of that model. The segment meshes are downloaded at build
  time by `tools/build_fly_body.py` and are not stored in this repository.

## Virtual Fly Brain (VFB)

* Source: https://virtualflybrain.org – neuropil and neuron images registered
  to the JRC2018Unisex template.
* Licence: each dataset carries its own licence (mostly CC-BY 4.0). The
  build pipeline records the dataset and licence of every bundled object in
  `godot/assets/generated/vfb/manifest.json`, and the app shows them in the
  term-info panel. Please cite the original data providers listed there and
  VFB itself: Court R. et al. *Virtual Fly Brain – An interactive atlas of the
  Drosophila nervous system.* Frontiers in Physiology (2023).

## Godot Engine

* https://godotengine.org – MIT licence.
