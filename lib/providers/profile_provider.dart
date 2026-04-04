import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/profile.dart';
import 'config_provider.dart';

final profilesProvider = Provider<Map<String, Profile>>((ref) {
  return ref.read(configLoaderProvider).loadProfiles();
});

final selectedProfileProvider = StateProvider<String?>((ref) => null);

final activeProfileProvider = Provider<Profile?>((ref) {
  final profiles = ref.watch(profilesProvider);
  final selected = ref.watch(selectedProfileProvider);
  if (selected == null) return profiles['default'];
  return profiles[selected] ?? profiles['default'];
});
