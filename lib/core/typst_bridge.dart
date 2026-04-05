import 'dart:typed_data';
import 'package:flutter/services.dart';
import 'package:typst_flutter/typst_flutter.dart' as typst;
// ignore: implementation_imports
import 'package:typst_flutter/src/rust/api/typst_compiler.dart' as rust;
import '../models/input_field.dart';

class TypstBridge {
  static bool _initialized = false;
  static List<typst.FontSource> _bundledFonts = [];

  static Future<void> init() async {
    if (!_initialized) {
      await typst.TypstFlutter.init();
      _bundledFonts = await _loadBundledFonts();
      _initialized = true;
    }
  }

  static Future<List<typst.FontSource>> _loadBundledFonts() async {
    const fontFiles = [
      'assets/fonts/SourceSerif4-Regular.ttf',
      'assets/fonts/SourceSerif4-Bold.ttf',
      'assets/fonts/SourceSans3-Regular.ttf',
      'assets/fonts/SourceSans3-Bold.ttf',
      'assets/fonts/SourceCodePro-Regular.ttf',
    ];
    final fonts = <typst.FontSource>[];
    for (final path in fontFiles) {
      try {
        final data = await rootBundle.load(path);
        fonts.add(typst.FontSource.bytes(data.buffer.asUint8List()));
      } catch (_) {
        // Font not found — skip
      }
    }
    return fonts;
  }

  static Future<List<InputField>> discoverInputs(
      String templateSource) async {
    await init();
    final results = await rust.discoverInputs(source: templateSource);
    return results
        .map(
          (r) => InputField(
            name: r.name,
            required: r.required_,
            defaultValue: r.defaultValue,
          ),
        )
        .toList();
  }

  static Future<Uint8List> compile({
    required String templateSource,
    required Map<String, String> inputs,
    List<typst.FontSource> extraFonts = const [],
    List<typst.ExtraFileSource> files = const [],
  }) async {
    await init();
    return typst.TypstFlutter.compileString(
      template: templateSource,
      inputs: inputs,
      fonts: [..._bundledFonts, ...extraFonts],
      extraFiles: files,
    );
  }
}
