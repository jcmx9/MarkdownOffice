import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/input_field.dart';
import '../../providers/editor_provider.dart';
import '../../providers/profile_provider.dart';
import '../../providers/template_provider.dart';

const _defaultOverrides = {
  'closing': 'Mit freundlichem Gruß',
};

const _months = [
  '',
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

String _formatDate(DateTime d) {
  return '${d.day}. ${_months[d.month]} ${d.year}';
}

class DynamicForm extends ConsumerStatefulWidget {
  const DynamicForm({super.key});

  @override
  ConsumerState<DynamicForm> createState() => _DynamicFormState();
}

class _DynamicFormState extends ConsumerState<DynamicForm> {
  final Map<String, TextEditingController> _controllers = {};
  final TextEditingController _bodyController = TextEditingController();
  List<InputField> _currentFields = [];
  DateTime _selectedDate = DateTime.now();

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    _bodyController.dispose();
    super.dispose();
  }

  void _syncFieldValues() {
    final values = <String, String>{};
    for (final entry in _controllers.entries) {
      if (entry.value.text.isNotEmpty) {
        values[entry.key] = entry.value.text;
      }
    }
    // Always include date
    values['date'] = _formatDate(_selectedDate);
    ref.read(fieldValuesProvider.notifier).state = values;
  }

  void _syncBody() {
    ref.read(bodyTextProvider.notifier).state = _bodyController.text;
  }

  void _rebuildControllers(
    List<InputField> fields,
    Map<String, String> profileValues,
  ) {
    final newKeys = fields.map((f) => f.name).toSet();
    final oldKeys = _controllers.keys.toSet();
    for (final key in oldKeys.difference(newKeys)) {
      _controllers[key]?.dispose();
      _controllers.remove(key);
    }

    for (final field in fields) {
      if (field.name == 'date' || field.name == 'body') continue;
      if (!_controllers.containsKey(field.name)) {
        final initial = profileValues[field.name] ??
            _defaultOverrides[field.name] ??
            field.defaultValue ??
            '';
        _controllers[field.name] = TextEditingController(text: initial);
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

        final visibleFields =
            fields.where((f) => f.name != 'body' && f.name != 'date').toList();

        return SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Date picker
              _buildDateField(context),
              const SizedBox(height: 12),
              // Template fields
              ...visibleFields.map((field) => _buildFieldTile(field)),
              const SizedBox(height: 16),
              const Text(
                'Brieftext',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              Focus(
                onFocusChange: (hasFocus) {
                  if (!hasFocus) _syncBody();
                },
                child: TextField(
                  controller: _bodyController,
                  maxLines: null,
                  minLines: 8,
                  keyboardType: TextInputType.multiline,
                  decoration: const InputDecoration(
                    hintText: 'Brieftext eingeben...',
                    border: OutlineInputBorder(),
                  ),
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

  Widget _buildDateField(BuildContext context) {
    return InkWell(
      onTap: () async {
        final picked = await showDatePicker(
          context: context,
          initialDate: _selectedDate,
          firstDate: DateTime(2000),
          lastDate: DateTime(2100),
        );
        if (picked != null) {
          setState(() {
            _selectedDate = picked;
          });
          _syncFieldValues();
        }
      },
      child: InputDecorator(
        decoration: const InputDecoration(
          labelText: 'Datum',
          border: OutlineInputBorder(),
          suffixIcon: Icon(Icons.calendar_today),
        ),
        child: Text(_formatDate(_selectedDate)),
      ),
    );
  }

  Widget _buildFieldTile(InputField field) {
    final controller = _controllers[field.name];
    if (controller == null) return const SizedBox.shrink();

    final label =
        field.required ? '${field.displayLabel} *' : field.displayLabel;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Focus(
        onFocusChange: (hasFocus) {
          if (!hasFocus) _syncFieldValues();
        },
        child: TextField(
          controller: controller,
          decoration: InputDecoration(
            labelText: label,
            hintText: field.defaultValue,
            border: const OutlineInputBorder(),
          ),
        ),
      ),
    );
  }
}
