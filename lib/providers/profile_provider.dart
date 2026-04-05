import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/profile.dart';
import 'config_provider.dart';
import 'template_provider.dart';

/// All profiles grouped by template name.
final allProfilesProvider =
    StateProvider<Map<String, Map<String, Profile>>>((ref) {
  return ref.read(configLoaderProvider).loadAllProfiles();
});

/// Profiles for the currently selected template.
final templateProfilesProvider = Provider<Map<String, Profile>>((ref) {
  final all = ref.watch(allProfilesProvider);
  final selected = ref.watch(selectedTemplateProvider);
  if (selected == null) return {};
  return all[selected.name] ?? {};
});

final selectedProfileProvider = StateProvider<String?>((ref) => null);

final activeProfileProvider = Provider<Profile?>((ref) {
  final profiles = ref.watch(templateProfilesProvider);
  final selected = ref.watch(selectedProfileProvider);
  if (selected != null && profiles.containsKey(selected)) {
    return profiles[selected];
  }
  return profiles['default'];
});
