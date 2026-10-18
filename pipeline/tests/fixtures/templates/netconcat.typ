// Test set: builds the package spec by string concatenation, which no text scan can see.
// The pipeline runs Typst with an unreachable proxy, so the (real, unbundled) package
// cannot be downloaded: the build fails and nothing is written into vendor/packages.
#import ("@pre" + "view/example:0.1.0"): *
Text
