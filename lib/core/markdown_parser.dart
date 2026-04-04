import 'package:yaml/yaml.dart';

class SplitResult {
  final String frontmatter;
  final String body;
  const SplitResult({required this.frontmatter, required this.body});
}

class FrontmatterData {
  final String? templateName;
  final String? profileName;
  final Map<String, String> fieldValues;

  const FrontmatterData({
    this.templateName,
    this.profileName,
    required this.fieldValues,
  });
}

SplitResult splitFrontmatter(String content) {
  final trimmed = content.trimLeft();
  if (!trimmed.startsWith('---')) {
    return SplitResult(frontmatter: '', body: content);
  }
  final endIndex = trimmed.indexOf('---', 3);
  if (endIndex == -1) {
    return SplitResult(frontmatter: '', body: content);
  }
  return SplitResult(
    frontmatter: trimmed.substring(3, endIndex).trim(),
    body: trimmed.substring(endIndex + 3),
  );
}

FrontmatterData parseFrontmatter(String yaml) {
  if (yaml.isEmpty) {
    return const FrontmatterData(fieldValues: {});
  }
  final parsed = loadYaml(yaml);
  if (parsed is! YamlMap) {
    return const FrontmatterData(fieldValues: {});
  }
  final fieldValues = <String, String>{};
  String? templateName;
  String? profileName;

  for (final entry in parsed.entries) {
    final key = entry.key.toString();
    if (key == 'template') {
      templateName = entry.value.toString();
    } else if (key == 'profile') {
      profileName = entry.value.toString();
    } else {
      fieldValues[key] = entry.value.toString();
    }
  }

  return FrontmatterData(
    templateName: templateName,
    profileName: profileName,
    fieldValues: fieldValues,
  );
}
