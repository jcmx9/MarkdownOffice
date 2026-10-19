// Test set: prints values read with frontmatter() so the test can check lists, maps and
// x- keys, and the pipeline's own inputs for keys the shell parsers must not touch.
#import sys.inputs.mdo + "/lib/markdown.typ": frontmatter
#set document(title: "FM-TEST")
#set text(font: ("SourceSans3VF",), lang: "de")
#let fm = frontmatter(read(sys.inputs.source))
TO=#fm.at("x-to", default: ()).join("|")

SUBJ=#fm.at("x-subject", default: "")

NESTED=#fm.at("x-map", default: (:)).at("inner", default: "")

DATEIN=#sys.inputs.at("date", default: "")

TITLEIN=#sys.inputs.at("doctitle", default: "")

EMPTY=#frontmatter("kein Frontmatter").len()
