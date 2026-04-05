import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/profile_provider.dart';
import '../../providers/template_provider.dart';
import 'profile_editor.dart';

class ProfilesScreen extends ConsumerWidget {
  const ProfilesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selectedTemplate = ref.watch(selectedTemplateProvider);
    final profiles = ref.watch(templateProfilesProvider);
    final templateName = selectedTemplate?.name ?? 'Kein Template';

    return Scaffold(
      appBar: AppBar(title: Text('Profile — $templateName')),
      floatingActionButton: selectedTemplate == null
          ? null
          : FloatingActionButton(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => const ProfileEditor(profileName: null),
                ),
              ),
              child: const Icon(Icons.add),
            ),
      body: selectedTemplate == null
          ? const Center(child: Text('Bitte zuerst ein Template wählen.'))
          : profiles.isEmpty
              ? const Center(child: Text('Keine Profile für dieses Template.'))
              : ListView(
                  children: profiles.entries
                      .map(
                        (entry) => ListTile(
                          title: Text(entry.key),
                          subtitle: Text(
                              entry.value.values['sender_name'] ?? ''),
                          onTap: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) =>
                                  ProfileEditor(profileName: entry.key),
                            ),
                          ),
                        ),
                      )
                      .toList(),
                ),
    );
  }
}
