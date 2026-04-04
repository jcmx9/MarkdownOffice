import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/config_loader.dart';
import '../core/typst_bridge.dart';
import '../models/input_field.dart';
import 'config_provider.dart';

final templateListProvider = Provider<List<TemplateInfo>>((ref) {
  return ref.read(configLoaderProvider).listTemplates();
});

final selectedTemplateProvider = StateProvider<TemplateInfo?>((ref) {
  final templates = ref.read(templateListProvider);
  return templates.isNotEmpty ? templates.first : null;
});

final templateSourceProvider = Provider<String?>((ref) {
  final selected = ref.watch(selectedTemplateProvider);
  if (selected == null) return null;
  return ref.read(configLoaderProvider).loadTemplateSource(selected.path);
});

final templateInputsProvider = FutureProvider<List<InputField>>((ref) async {
  final source = ref.watch(templateSourceProvider);
  if (source == null) return [];
  final fields = await TypstBridge.discoverInputs(source);
  final selected = ref.read(selectedTemplateProvider);
  if (selected == null) return fields;
  final labels = ref.read(configLoaderProvider).loadLabels(selected.name);
  return fields.map((f) => InputField(
    name: f.name,
    required: f.required,
    defaultValue: f.defaultValue,
    label: labels[f.name],
  )).toList();
});
