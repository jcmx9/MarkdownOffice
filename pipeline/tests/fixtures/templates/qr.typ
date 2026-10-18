// Test set: the QR package from the offline store (@preview/cades imports @preview/jogs).
#import "@preview/cades:0.3.1": qr-code
#set document(title: "QR-TEST")
#set text(font: ("SourceSans3VF",))
QR-OK
#qr-code("BEGIN:VCARD\nVERSION:3.0\nFN:Test\nEND:VCARD", width: 16mm)
