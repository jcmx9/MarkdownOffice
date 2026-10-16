// Test-Set: zeigt, dass ein Set außerhalb der Installation die Bausteine von
// Markdown Office über sys.inputs.mdo einbinden kann (Markdown-Vorverarbeitung + cmarker).
#import sys.inputs.mdo + "/lib/markdown.typ": preprocess
#import sys.inputs.mdo + "/vendor/cmarker/lib.typ" as cmarker
#set document(title: "SET-PROBE")
#set text(font: ("SourceSans3VF",), lang: "de")
SET-PROBE #sys.inputs.at("doctitle", default: "")

#cmarker.render(preprocess(read(sys.inputs.source)))
