import 'dart:typed_data';
import 'package:typst_flutter/typst_flutter.dart' as typst;
// ignore: implementation_imports
import 'package:typst_flutter/src/rust/api/typst_compiler.dart' as rust;
import '../models/input_field.dart';
import 'font_manager.dart';

class TypstBridge {
  static bool _initialized = false;

  static Future<void> init() async {
    if (!_initialized) {
      await typst.TypstFlutter.init();
      _initialized = true;
    }
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
    // Auto-discover and load all fonts the template needs
    final fonts = await FontManager.getFontsForTemplate(templateSource);
    return typst.TypstFlutter.compileString(
      template: templateSource,
      inputs: inputs,
      fonts: [...fonts, ...extraFonts],
      extraFiles: files,
    );
  }
}
