import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/config_loader.dart';
import '../models/config.dart';

final configLoaderProvider = Provider<ConfigLoader>((ref) {
  throw UnimplementedError('Override in main with platform-specific paths');
});

final configProvider = Provider<AppConfig>((ref) {
  return ref.read(configLoaderProvider).loadConfig();
});
