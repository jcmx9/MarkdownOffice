import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/profile_provider.dart';

class ProfileEditor extends ConsumerStatefulWidget {
  final String? profileName;
  const ProfileEditor({super.key, required this.profileName});

  @override
  ConsumerState<ProfileEditor> createState() => _ProfileEditorState();
}

class _ProfileEditorState extends ConsumerState<ProfileEditor> {
  final _controllers = <String, TextEditingController>{};
  final _nameController = TextEditingController();

  @override
  void initState() {
    super.initState();
    if (widget.profileName != null) {
      _nameController.text = widget.profileName!;
      final profile = ref.read(templateProfilesProvider)[widget.profileName];
      if (profile != null) {
        for (final entry in profile.values.entries) {
          _controllers[entry.key] = TextEditingController(text: entry.value);
        }
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

  void _addField() {
    setState(() {
      final key = 'feld_${_controllers.length + 1}';
      _controllers[key] = TextEditingController();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.profileName == null ? 'Neues Profil' : 'Profil bearbeiten',
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: _addField,
            tooltip: 'Feld hinzufuegen',
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            TextField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: 'Profilname',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            for (final entry in _controllers.entries)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: TextField(
                  controller: entry.value,
                  decoration: InputDecoration(
                    labelText: entry.key,
                    border: const OutlineInputBorder(),
                  ),
                ),
              ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Speichern'),
            ),
          ],
        ),
      ),
    );
  }
}
