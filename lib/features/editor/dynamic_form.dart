import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/input_field.dart';
import '../../providers/editor_provider.dart';
import '../../providers/profile_provider.dart';
import '../../providers/template_provider.dart';

class DynamicForm extends ConsumerStatefulWidget {
  const DynamicForm({super.key});

  @override
  ConsumerState<DynamicForm> createState() => _DynamicFormState();
}

class _DynamicFormState extends ConsumerState<DynamicForm> {
  final Map<String, TextEditingController> _controllers = {};
  final TextEditingController _bodyController = TextEditingController();
  List<InputField> _currentFields = [];

  @override
  void initState() {
    super.initState();
    _bodyController.addListener(_onBodyChanged);
  }

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    _bodyController.removeListener(_onBodyChanged);
    _bodyController.dispose();
    super.dispose();
  }

  void _onBodyChanged() {
    ref.read(bodyTextProvider.notifier).state = _bodyController.text;
  }

  void _syncFieldValues() {
    final values = <String, String>{};
    for (final entry in _controllers.entries) {
      values[entry.key] = entry.value.text;
    }
    ref.read(fieldValuesProvider.notifier).state = values;
  }

  void _rebuildControllers(List<InputField> fields, Map<String, String> profileValues) {
    // Dispose old controllers that are no longer needed
    final newKeys = fields.map((f) => f.name).toSet();
    final oldKeys = _controllers.keys.toSet();
    for (final key in oldKeys.difference(newKeys)) {
      _controllers[key]?.dispose();
      _controllers.remove(key);
    }

    for (final field in fields) {
      if (!_controllers.containsKey(field.name)) {
        final initial = profileValues[field.name] ?? '';
        final controller = TextEditingController(text: initial);
        controller.addListener(_syncFieldValues);
        _controllers[field.name] = controller;
      }
    }

    _currentFields = fields;
    _syncFieldValues();
  }

  @override
  Widget build(BuildContext context) {
    final inputsAsync = ref.watch(templateInputsProvider);
    final activeProfile = ref.watch(activeProfileProvider);
    final profileValues = activeProfile?.values ?? {};

    return inputsAsync.when(
      data: (fields) {
        // Rebuild controllers when field list changes
        if (_fieldsChanged(fields)) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) {
              _rebuildControllers(fields, profileValues);
              setState(() {});
            }
          });
        }

        if (fields.isEmpty) {
          return const Center(child: Text('Kein Template ausgewählt.'));
        }

        return SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ...fields.map((field) => _buildFieldTile(field)),
              const SizedBox(height: 16),
              const Text(
                'Brieftext',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _bodyController,
                maxLines: null,
                minLines: 8,
                keyboardType: TextInputType.multiline,
                decoration: const InputDecoration(
                  hintText: 'Brieftext eingeben...',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('Fehler: $e')),
    );
  }

  bool _fieldsChanged(List<InputField> fields) {
    if (fields.length != _currentFields.length) return true;
    for (var i = 0; i < fields.length; i++) {
      if (fields[i].name != _currentFields[i].name) return true;
    }
    return false;
  }

  Widget _buildFieldTile(InputField field) {
    final controller = _controllers[field.name];
    if (controller == null) return const SizedBox.shrink();

    final label = field.required ? '${field.displayLabel} *' : field.displayLabel;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: controller,
        decoration: InputDecoration(
          labelText: label,
          hintText: field.defaultValue,
          border: const OutlineInputBorder(),
        ),
      ),
    );
  }
}
