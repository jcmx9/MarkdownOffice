import 'package:flutter_test/flutter_test.dart';
import 'package:typst_flutter/typst_flutter.dart';

// This test requires the native Rust library to be compiled.
// It will pass when run as part of a full platform build (e.g. via
// `flutter run` or `flutter build macos`), but is skipped in the
// pure Dart VM environment used by `flutter test`.
//
// To run against a real device or macOS:
//   flutter test integration_test/ --device-id=<id>
void main() {
  test(
    'Typst compiles a simple template to PDF',
    () async {
      await TypstFlutter.init();
      final pdfBytes = await TypstFlutter.compileString(
        template: '= Hello, World!',
      );
      expect(pdfBytes, isNotEmpty);
      expect(String.fromCharCodes(pdfBytes.sublist(0, 4)), '%PDF');
    },
    skip:
        'Requires native Rust dylib — run via `flutter build macos` or integration test.',
  );
}
