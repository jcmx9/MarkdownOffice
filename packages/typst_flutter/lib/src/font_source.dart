import 'dart:io';

import 'package:flutter/services.dart';

abstract class FontSource {
  const FontSource();

  String? get path;
  Future<Uint8List> load();

  const factory FontSource.asset(String assetPath, {String? typstPath}) =
      _AssetFontSource;
  const factory FontSource.bytes(Uint8List bytes, {String? typstPath}) =
      _BytesFontSource;
  factory FontSource.file(File file, {String? typstPath}) = _FileFontSource;
}

class _AssetFontSource extends FontSource {
  final String assetPath;
  @override
  final String? path;

  const _AssetFontSource(this.assetPath, {String? typstPath})
    : path = typstPath ?? assetPath;

  @override
  Future<Uint8List> load() async {
    final data = await rootBundle.load(assetPath);
    return data.buffer.asUint8List();
  }
}

class _BytesFontSource extends FontSource {
  final Uint8List bytes;
  @override
  final String? path;

  const _BytesFontSource(this.bytes, {String? typstPath}) : path = typstPath;

  @override
  Future<Uint8List> load() async => bytes;
}

class _FileFontSource extends FontSource {
  final File file;
  @override
  final String? path;

  _FileFontSource(this.file, {String? typstPath})
    : path = typstPath ?? file.path.split('/').last;

  @override
  Future<Uint8List> load() async => file.readAsBytes();
}
