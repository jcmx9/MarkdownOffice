import 'dart:io';
import 'package:yaml/yaml.dart';
import '../models/config.dart';
import '../models/profile.dart';

class TemplateInfo {
  final String name;
  final String path;

  const TemplateInfo({required this.name, required this.path});
}

class ConfigLoader {
  final String homePath;
  final String? cwdPath;
  final String? cloudPath;

  ConfigLoader({required this.homePath, this.cwdPath, this.cloudPath});

  AppConfig loadConfig() {
    final file = File('$homePath/mdo_config.yaml');
    if (!file.existsSync()) return const AppConfig();
    final yaml = loadYaml(file.readAsStringSync());
    if (yaml is! YamlMap) return const AppConfig();
    return AppConfig.fromMap(_yamlToMap(yaml));
  }

  Map<String, Profile> loadProfiles() {
    final content = _findFile('mdo_profiles.yaml');
    if (content == null) return {};
    final yaml = loadYaml(content);
    if (yaml is! YamlMap) return {};
    final profiles = <String, Profile>{};
    for (final entry in yaml.entries) {
      final name = entry.key.toString();
      if (entry.value is YamlMap) {
        profiles[name] = Profile.fromMap(
          name,
          _yamlToMap(entry.value as YamlMap),
        );
      }
    }
    return profiles;
  }

  List<TemplateInfo> listTemplates() {
    final templates = <String, TemplateInfo>{};
    for (final path in _searchPaths.reversed) {
      final dir = Directory('$path/templates');
      if (!dir.existsSync()) continue;
      for (final file in dir.listSync()) {
        if (file is File && file.path.endsWith('.typ')) {
          final name = file.uri.pathSegments.last.replaceAll('.typ', '');
          templates[name] = TemplateInfo(name: name, path: file.path);
        }
      }
    }
    return templates.values.toList();
  }

  String loadTemplateSource(String path) {
    return File(path).readAsStringSync();
  }

  Map<String, String> loadLabels(String templateName) {
    for (final path in _searchPaths) {
      final file = File('$path/templates/$templateName.labels.yaml');
      if (file.existsSync()) {
        final yaml = loadYaml(file.readAsStringSync());
        if (yaml is YamlMap) {
          return yaml.entries.fold<Map<String, String>>({}, (map, entry) {
            map[entry.key.toString()] = entry.value.toString();
            return map;
          });
        }
      }
    }
    return {};
  }

  List<String> get _searchPaths {
    return [?cwdPath, ?cloudPath, homePath];
  }

  String? _findFile(String filename) {
    for (final path in _searchPaths) {
      final file = File('$path/$filename');
      if (file.existsSync()) return file.readAsStringSync();
    }
    return null;
  }

  static Map<String, dynamic> _yamlToMap(YamlMap yaml) {
    final map = <String, dynamic>{};
    for (final entry in yaml.entries) {
      final key = entry.key.toString();
      final value = entry.value;
      if (value is YamlMap) {
        map[key] = _yamlToMap(value);
      } else if (value is YamlList) {
        map[key] = value.map((e) => e is YamlMap ? _yamlToMap(e) : e).toList();
      } else {
        map[key] = value;
      }
    }
    return map;
  }
}
