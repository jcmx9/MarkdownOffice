import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/profile_provider.dart';
import 'profile_editor.dart';

class ProfilesScreen extends ConsumerWidget {
  const ProfilesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profiles = ref.watch(profilesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      floatingActionButton: FloatingActionButton(
        onPressed: () => Navigator.push(context,
          MaterialPageRoute(builder: (_) => const ProfileEditor(profileName: null))),
        child: const Icon(Icons.add),
      ),
      body: profiles.isEmpty
          ? const Center(child: Text('Keine Profile vorhanden.'))
          : ListView(
              children: profiles.entries.map((entry) => ListTile(
                title: Text(entry.key),
                subtitle: Text(entry.value.values['sender_name'] ?? ''),
                onTap: () => Navigator.push(context,
                  MaterialPageRoute(builder: (_) => ProfileEditor(profileName: entry.key))),
              )).toList(),
            ),
    );
  }
}
