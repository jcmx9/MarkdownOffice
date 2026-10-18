// Test set: imports a package that is not bundled; the pipeline must refuse it before
// Typst would try to download it.
#import "@preview/gibtsnicht:1.0.0": nichts
Text
