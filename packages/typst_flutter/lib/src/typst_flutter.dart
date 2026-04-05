import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:typst_flutter/src/extra_file_source.dart';
import 'package:typst_flutter/src/font_source.dart';
import 'package:typst_flutter/src/rust/frb_generated.dart';

import 'rust/api/typst_compiler.dart' as rust;

class TypstFlutter {
  TypstFlutter._();

  /// Initializes the Rust library.
  /// This must be called before using any other method in [TypstFlutter].
  static Future<void> init() async {
    await RustLib.init();
  }

  static Future<Uint8List> _compile({
    required String template,
    Map<String, String>? inputs,
    List<FontSource> fonts = const [],
    List<ExtraFileSource> extraFiles = const [],
  }) async {
    final loadedFonts = await Future.wait(fonts.map((f) => f.load()));

    final loadedExtras = await Future.wait(
      extraFiles.map(
        (f) async =>
            rust.TypstFileInput(path: f.path, data: await f.loadBytes()),
      ),
    );

    final result = await rust.compile(
      template: template,
      inputs: inputs,
      fonts: loadedFonts,
      extraFiles: loadedExtras,
    );

    for (final w in result.warnings) {
      debugPrint('[typst] $w');
    }
    return result.pdfBytes;
  }

  /// Compiles a Typst template from a string.
  ///
  /// [template]   — content of the .typ file as a string
  /// [inputs]     — Map that will be serialized to JSON and injected into the template
  /// [fonts]      — list of [FontSource] containing fonts (.ttf/.otf)
  /// [extraFiles] — list of [ExtraFileSource] for extra files referenced in the template
  static Future<Uint8List> compileString({
    required String template,
    Map<String, String>? inputs,
    List<FontSource> fonts = const [],
    List<ExtraFileSource> extraFiles = const [],
  }) => _compile(
    template: template,
    inputs: inputs,
    fonts: fonts,
    extraFiles: extraFiles,
  );

  /// Compiles a Typst template from a Flutter asset.
  ///
  /// [assetPath]  — path to the .typ file in the Flutter assets
  /// [inputs]     — Map that will be serialized to JSON and injected into the template
  /// [fonts]      — list of [FontSource] containing fonts (.ttf/.otf)
  /// [extraFiles] — list of [ExtraFileSource] for extra files referenced in the template
  static Future<Uint8List> compileAsset({
    required String assetPath,
    Map<String, String>? inputs,
    List<FontSource> fonts = const [],
    List<ExtraFileSource> extraFiles = const [],
  }) async {
    final template = await rootBundle.loadString(assetPath);
    return _compile(
      template: template,
      inputs: inputs,
      fonts: fonts,
      extraFiles: extraFiles,
    );
  }

  /// Compiles a Typst template from a [File].
  ///
  /// [file]       — the .typ [File] to compile
  /// [inputs]     — Map that will be serialized to JSON and injected into the template
  /// [fonts]      — list of [FontSource] containing fonts (.ttf/.otf)
  /// [extraFiles] — list of [ExtraFileSource] for extra files referenced in the template
  static Future<Uint8List> compileFile({
    required File file,
    Map<String, String>? inputs,
    List<FontSource> fonts = const [],
    List<ExtraFileSource> extraFiles = const [],
  }) async {
    final template = await file.readAsString();
    return _compile(
      template: template,
      inputs: inputs,
      fonts: fonts,
      extraFiles: extraFiles,
    );
  }
}
