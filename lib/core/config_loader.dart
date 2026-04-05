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

  /// Load all profiles (template-specific).
  /// YAML format:
  /// ```yaml
  /// din5008_b:
  ///   default:
  ///     fields_order: [date, subject, recipient_name, ...]
  ///     values:
  ///       sender_name: Roland Kreus
  /// ```
  Map<String, Map<String, Profile>> loadAllProfiles() {
    final content = _findFile('mdo_profiles.yaml');
    if (content == null) return {};
    final yaml = loadYaml(content);
    if (yaml is! YamlMap) return {};
    final result = <String, Map<String, Profile>>{};
    for (final templateEntry in yaml.entries) {
      final templateName = templateEntry.key.toString();
      if (templateEntry.value is! YamlMap) continue;
      final profiles = <String, Profile>{};
      for (final profileEntry in (templateEntry.value as YamlMap).entries) {
        final profileName = profileEntry.key.toString();
        if (profileEntry.value is YamlMap) {
          profiles[profileName] = Profile.fromMap(
            profileName,
            _yamlToMap(profileEntry.value as YamlMap),
          );
        }
      }
      result[templateName] = profiles;
    }
    return result;
  }

  /// Load profiles for a specific template.
  Map<String, Profile> loadProfiles({String? templateName}) {
    final all = loadAllProfiles();
    if (templateName != null && all.containsKey(templateName)) {
      return all[templateName]!;
    }
    return {};
  }

  /// Save profiles YAML to the home config path.
  void saveProfiles(Map<String, Map<String, Profile>> allProfiles) {
    final buffer = StringBuffer();
    for (final templateEntry in allProfiles.entries) {
      buffer.writeln('${templateEntry.key}:');
      for (final profileEntry in templateEntry.value.entries) {
        buffer.writeln('  ${profileEntry.key}:');
        final profile = profileEntry.value;
        if (profile.fieldsOrder.isNotEmpty) {
          buffer.writeln('    fields_order:');
          for (final field in profile.fieldsOrder) {
            buffer.writeln('      - $field');
          }
        }
        buffer.writeln('    values:');
        for (final entry in profile.values.entries) {
          buffer.writeln('      ${entry.key}: ${entry.value}');
        }
      }
    }
    final dir = Directory(homePath);
    if (!dir.existsSync()) dir.createSync(recursive: true);
    File('$homePath/mdo_profiles.yaml').writeAsStringSync(buffer.toString());
  }

  /// Download a .typ template from URL and save to templates dir.
  Future<File> importTemplate(String url, {String? name}) async {
    final uri = Uri.parse(url);
    final client = HttpClient();
    try {
      final request = await client.getUrl(uri);
      final response = await request.close();
      final bytes = await response.fold<List<int>>(
        [],
        (prev, chunk) => prev..addAll(chunk),
      );
      final fileName = name ?? uri.pathSegments.last;
      final templateName =
          fileName.endsWith('.typ') ? fileName : '$fileName.typ';
      final dir = Directory('$homePath/templates');
      if (!dir.existsSync()) dir.createSync(recursive: true);
      final file = File('${dir.path}/$templateName');
      file.writeAsBytesSync(bytes);
      return file;
    } finally {
      client.close();
    }
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
