// Parity fixture for the preview's formulas (pipeline/tests/test-math.sh). Two modes:
//
// - `note=<path>`: renders the note through the vendored cmarker as memo.typ does, with a `math:`
//   function that only records each formula, so `typst eval 'query(metadata).map(m => m.value)'`
//   lists every (tex, block) cmarker hands to the set: the PDF's delimiter decisions.
// - `formulas=<path>` (JSON list of {tex, display}): sets each formula on its own page with the
//   PDF's toolchain: mitex imported from the pipeline root as memo.typ does, the call cmarker
//   makes (`mitex(tex, block: …)`), compiled by the script with build.sh's font flags. Page
//   geometry as the bounds page of src/core/math.ts MATH_PROGRAM (tight, 10pt, inline formulas
//   with top and bottom edge at the glyph bounds), so the two SVGs are comparable as a whole.
//
// The script passes the pipeline root as `mdo`; paths are absolute (`--root /` like build.sh).
#import sys.inputs.mdo + "/vendor/cmarker/lib.typ" as cmarker
#import sys.inputs.mdo + "/vendor/mitex/lib.typ": mitex

#if "note" in sys.inputs {
  cmarker.render(
    read(sys.inputs.note),
    h1-level: 1,
    math: (tex, block: false) => metadata((tex: tex, display: block)),
  )
} else {
  set page(width: auto, height: auto, margin: 0pt, fill: none)
  set text(size: 10pt)
  for (i, item) in json(sys.inputs.formulas).enumerate() {
    if i > 0 { pagebreak() }
    if item.display {
      mitex(item.tex, block: true)
    } else {
      text(top-edge: "bounds", bottom-edge: "bounds", mitex(item.tex, block: false))
    }
  }
}
