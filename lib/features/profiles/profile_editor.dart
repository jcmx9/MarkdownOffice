import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/input_field.dart';
import '../../models/profile.dart';
import '../../providers/config_provider.dart';
import '../../providers/profile_provider.dart';
import '../../providers/template_provider.dart';

class ProfileEditor extends ConsumerStatefulWidget {
  final String? profileName;
  const ProfileEditor({super.key, required this.profileName});

  @override
  ConsumerState<ProfileEditor> createState() => _ProfileEditorState();
}

class _ProfileEditorState extends ConsumerState<ProfileEditor> {
  final _nameController = TextEditingController();
  final _controllers = <String, TextEditingController>{};
  final _visibleFields = <String>[];
  List<InputField> _templateFields = [];

  @override
  void initState() {
    super.initState();

    // Get template fields
    _templateFields =
        ref.read(templateInputsProvider).valueOrNull ?? [];

    if (widget.profileName != null) {
      // Edit existing profile
      _nameController.text = widget.profileName!;
      final profile =
          ref.read(templateProfilesProvider)[widget.profileName];
      if (profile != null) {
        // Create controllers for all template fields with profile values
        for (final field in _templateFields) {
          if (field.name == 'body') continue;
          final value = profile.values[field.name] ?? '';
          _controllers[field.name] = TextEditingController(text: value);
        }
        _visibleFields.addAll(
          profile.fieldsOrder.isNotEmpty
              ? profile.fieldsOrder
              : _templateFields
                    .where((f) => f.name != 'body')
                    .map((f) => f.name),
        );
      }
    } else {
      // New profile — pre-fill with all template fields
      for (final field in _templateFields) {
        if (field.name == 'body') continue;
        _controllers[field.name] = TextEditingController(
          text: field.defaultValue ?? '',
        );
        _visibleFields.add(field.name);
      }
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _save() {
    final profileName = _nameController.text.trim();
    if (profileName.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Bitte Profilnamen eingeben.')),
      );
      return;
    }

    final templateName = ref.read(selectedTemplateProvider)?.name;
    if (templateName == null) return;

    // Collect values (only non-empty)
    final values = <String, String>{};
    for (final entry in _controllers.entries) {
      if (entry.value.text.isNotEmpty) {
        values[entry.key] = entry.value.text;
      }
    }

    // Fields order = visible fields in current order
    final fieldsOrder = List<String>.from(_visibleFields);

    final profile = Profile(
      name: profileName,
      fieldsOrder: fieldsOrder,
      values: values,
    );

    // Update state
    final allProfiles =
        Map<String, Map<String, Profile>>.from(ref.read(allProfilesProvider));
    final templateProfiles =
        Map<String, Profile>.from(allProfiles[templateName] ?? {});
    templateProfiles[profileName] = profile;
    allProfiles[templateName] = templateProfiles;
    ref.read(allProfilesProvider.notifier).state = allProfiles;

    // Save to disk
    ref.read(configLoaderProvider).saveProfiles(allProfiles);

    Navigator.pop(context);
  }

  String _fieldLabel(String fieldName) {
    final field = _templateFields.where((f) => f.name == fieldName).firstOrNull;
    return field?.displayLabel ?? fieldName;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.profileName == null ? 'Neues Profil' : 'Profil bearbeiten',
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: 'Profilname *',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 24),
            Text(
              'Formularfelder (Reihenfolge durch Ziehen ändern)',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            ReorderableListView(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              onReorder: (oldIndex, newIndex) {
                setState(() {
                  if (newIndex > oldIndex) newIndex--;
                  final item = _visibleFields.removeAt(oldIndex);
                  _visibleFields.insert(newIndex, item);
                });
              },
              children: [
                for (var i = 0; i < _visibleFields.length; i++)
                  ListTile(
                    key: ValueKey(_visibleFields[i]),
                    leading: const Icon(Icons.drag_handle),
                    title: TextField(
                      controller: _controllers[_visibleFields[i]],
                      decoration: InputDecoration(
                        labelText: _fieldLabel(_visibleFields[i]),
                        border: const OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _save,
              icon: const Icon(Icons.save),
              label: const Text('Profil speichern'),
            ),
          ],
        ),
      ),
    );
  }
}
