// Source entry for the vendored CodeMirror bundle. Not embedded/served — bundled
// by `make web-assets` into internal/web/static/vendor/codemirror.js (IIFE, global
// `MDO`). Kept in-repo so the committed bundle's provenance is auditable.
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";

export function createEditor(parent, doc, onChange) {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString());
        }),
      ],
    }),
  });
}
