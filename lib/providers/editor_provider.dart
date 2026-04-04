import 'dart:typed_data';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/typst_bridge.dart';
import 'template_provider.dart';

final fieldValuesProvider = StateProvider<Map<String, String>>((ref) => {});
final bodyTextProvider = StateProvider<String>((ref) => '');

final pdfBytesProvider = FutureProvider<Uint8List?>((ref) async {
  final source = ref.watch(templateSourceProvider);
  if (source == null) return null;

  final fieldValues = ref.watch(fieldValuesProvider);
  final body = ref.watch(bodyTextProvider);

  final inputs = Map<String, String>.from(fieldValues);
  if (body.isNotEmpty) inputs['body'] = body;

  try {
    return await TypstBridge.compile(templateSource: source, inputs: inputs);
  } catch (e) {
    return null;
  }
});
