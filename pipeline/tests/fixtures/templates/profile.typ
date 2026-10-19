// Test set: reads the profile the pipeline found (input `profile`) and the signature next
// to it, the way din5008a does.
#set document(title: "PROFILE-TEST")
#set text(font: ("SourceSans3VF",), lang: "de")
#let p = sys.inputs.at("profile", default: "")
#if p == "" [KEIN-PROFIL] else {
  let data = yaml(p)
  let dir = p.split("/").slice(0, -1).join("/")
  [NAME=#data.name]
  parbreak()
  image(bytes(read(dir + "/" + data.signature)), width: 40mm)
}
