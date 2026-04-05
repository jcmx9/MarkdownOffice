import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/typst_bridge.dart';
import 'template_provider.dart';

final fieldValuesProvider = StateProvider<Map<String, String>>((ref) => {});
final bodyTextProvider = StateProvider<String>((ref) => '');
final compileErrorProvider = StateProvider<String?>((ref) => null);

final pdfBytesProvider = FutureProvider<Uint8List?>((ref) async {
  final source = ref.watch(templateSourceProvider);
  if (source == null) return null;

  final fieldValues = ref.watch(fieldValuesProvider);
  final body = ref.watch(bodyTextProvider);

  // Build inputs — fill empty required fields with placeholder
  final inputs = <String, String>{};
  final templateInputs =
      ref.read(templateInputsProvider).valueOrNull ?? [];
  for (final field in templateInputs) {
    final value = fieldValues[field.name];
    if (value != null && value.isNotEmpty) {
      inputs[field.name] = value;
    } else if (field.defaultValue != null) {
      inputs[field.name] = field.defaultValue!;
    } else {
      // Required field without value — use space as placeholder
      inputs[field.name] = ' ';
    }
  }
  if (body.isNotEmpty) inputs['body'] = body;

  try {
    final result = await TypstBridge.compile(
      templateSource: source,
      inputs: inputs,
    );
    ref.read(compileErrorProvider.notifier).state = null;
    return result;
  } catch (e) {
    debugPrint('Typst compile error: $e');
    ref.read(compileErrorProvider.notifier).state = e.toString();
    return null;
  }
});
