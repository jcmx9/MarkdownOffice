// Parity fixture for src/core/mermaid.ts (pipeline/tests/test-mermaid.sh): draws every
// fixtures/mermaid/*.mmd with the bundled mmdr exactly as memo.typ's show rule does (same
// arguments, same font-weight replace) and exposes the SVG strings as the metadata <out>
// (`typst eval 'query(<out>).first().value'`). Keep the arguments in step with memo.typ and
// MEMO_MERMAID; the script passes the pipeline root as `mdo` and the fixture names as `names`.
#import sys.inputs.mdo + "/vendor/mmdr/lib.typ": mermaid-svg

// memo.typ: mermaid-layout, mermaid-theme.
#let mermaid-layout = (node_spacing: 25, rank_spacing: 35)
#let mermaid-theme = (
  font_family: "SourceSans3VF",
  primary_color: "#f4f2ee",
  primary_text_color: "#2b2b2b",
  primary_border_color: "#b9b2a6",
  secondary_color: "#fbeab0",
  tertiary_color: "#fdfcfa",
  line_color: "#6b6b6b",
  text_color: "#2b2b2b",
  edge_label_background: "#ffffff",
  cluster_background: "#fdfcfa",
  cluster_border: "#e4e1dc",
  background: "#ffffff",
  sequence_actor_fill: "#f4f2ee",
  sequence_actor_border: "#b9b2a6",
  sequence_actor_line: "#b9b2a6",
  sequence_note_fill: "#fbeab0",
  sequence_note_border: "#e0c66a",
)

// memo.typ's call and replace; the parentheses keep the method chain one expression.
#let draw(code) = (
  mermaid-svg(code, base-theme: "modern", theme: mermaid-theme, layout: mermaid-layout)
    .replace("font-family=", "font-weight=\"500\" font-family=")
)

#let names = sys.inputs.names.split(",")
#metadata(names.map(n => (n, draw(read("fixtures/mermaid/" + n + ".mmd")))).to-dict()) <out>
