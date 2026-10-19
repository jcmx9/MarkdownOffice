// Test set: a malformed spec (uppercase, underscore) still counts as a package import and
// is refused before Typst runs (the guard fails closed).
#import "@preview/Gibts_Nicht:1.0.0": nichts
Text
