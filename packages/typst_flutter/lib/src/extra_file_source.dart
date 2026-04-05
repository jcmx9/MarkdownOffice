import 'dart:io';

import 'package:flutter/services.dart';

abstract class ExtraFileSource {
  const ExtraFileSource();

  String get path;
  Future<Uint8List> loadBytes();

  const factory ExtraFileSource.asset(String assetPath, {String? typstPath}) =
      _AssetExtraFileSource;
  const factory ExtraFileSource.bytes(String path, Uint8List bytes) =
      _BytesExtraFileSource;
  factory ExtraFileSource.file(File file, {String? typstPath}) =
      _FileExtraFileSource;
}

class _AssetExtraFileSource extends ExtraFileSource {
  final String assetPath;
  final String? typstPath;

  const _AssetExtraFileSource(this.assetPath, {this.typstPath});

  @override
  String get path => typstPath ?? assetPath.split('/').last;

  @override
  Future<Uint8List> loadBytes() async {
    final data = await rootBundle.load(assetPath);
    return data.buffer.asUint8List();
  }
}

class _BytesExtraFileSource extends ExtraFileSource {
  @override
  final String path;
  final Uint8List bytes;

  const _BytesExtraFileSource(this.path, this.bytes);

  @override
  Future<Uint8List> loadBytes() async => bytes;
}

class _FileExtraFileSource extends ExtraFileSource {
  final File file;
  final String? typstPath;

  _FileExtraFileSource(this.file, {this.typstPath});

  @override
  String get path => typstPath ?? file.path.split('/').last;

  @override
  Future<Uint8List> loadBytes() async => await file.readAsBytes();
}
