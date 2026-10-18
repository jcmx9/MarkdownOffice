// Test set in a folder (<templates>/folderset/folderset.typ): proves that a cloned or
// catalog-installed set repo is found in the templates folder.
#import sys.inputs.mdo + "/lib/markdown.typ": preprocess
#import sys.inputs.mdo + "/vendor/cmarker/lib.typ" as cmarker
#set document(title: "SET-FOLDER")
#set text(font: ("SourceSans3VF",), lang: "de")
SET-FOLDER

#cmarker.render(preprocess(read(sys.inputs.source)))
