// Test set folder: the main file is clean; a helper file in the set folder imports an
// unbundled package. The guard scans every .typ of a set folder, so it is refused.
#import "helper.typ": nichts
Text
