# MarkdownOffice v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform Flutter app where any Typst template becomes a form-based document editor. User fills in fields, writes Markdown body, gets PDF. No Typst knowledge needed.

**Architecture:** Typst as rendering engine via FFI (`typst_flutter` fork with `discoverInputs` API). App reads `.typ` templates, discovers `sys.inputs.at(...)` calls via AST analysis, generates dynamic forms. Riverpod for state. macOS/iOS/iPadOS first.

**Tech Stack:** Flutter, Dart, `typst_flutter` (forked), `typst-syntax` (Rust), `flutter_riverpod`, `yaml`, `file_picker`, `printing`, `share_plus`.

**Note on `eval()` in Typst templates:** The DIN 5008 template uses Typst's `eval()` to render the user's Markdown body text. This runs inside Typst's sandboxed scripting engine (not Dart/JS eval) and is the standard Typst pattern for dynamic content. Typst's eval is safe — it cannot access the filesystem, network, or host system.

---

### Task 1: Fork and Extend typst_flutter

**Files:**
- Fork: `https://github.com/DeamonPedro/typst_flutter` → `https://github.com/jcmx9/typst_flutter`
- Modify: `rust/src/api.rs` (add `discover_inputs` function)
- Modify: `lib/typst_flutter.dart` (expose Dart API)

- [ ] **Step 1: Fork typst_flutter on GitHub**

```bash
gh repo fork DeamonPedro/typst_flutter --clone=false --org=jcmx9
gh repo clone jcmx9/typst_flutter ~/GitHub/typst_flutter
```

- [ ] **Step 2: Add typst-syntax dependency to Rust side**

In `rust/Cargo.toml`, add:

```toml
[dependencies]
typst-syntax = "0.14"
```

- [ ] **Step 3: Implement discover_inputs in Rust**

Add to `rust/src/api.rs`:

```rust
use typst_syntax::{ast, parse, SyntaxKind, SyntaxNode};

#[derive(Debug)]
pub struct InputField {
    pub name: String,
    pub required: bool,
    pub default_value: Option<String>,
}

pub fn discover_inputs(source: String) -> Vec<InputField> {
    let root = parse(&source);
    let mut fields = Vec::new();
    walk_for_inputs(root.root(), &mut fields);
    // Deduplicate by name, keep first occurrence
    let mut seen = std::collections::HashSet::new();
    fields.retain(|f| seen.insert(f.name.clone()));
    fields
}

fn walk_for_inputs(node: &SyntaxNode, fields: &mut Vec<InputField>) {
    if let Some(call) = node.cast::<ast::FuncCall>() {
        if let ast::Expr::FieldAccess(access) = call.callee() {
            if access.field().as_str() == "at" {
                if is_sys_inputs(access.target()) {
                    extract_input_field(call.args(), fields);
                }
            }
        }
    }
    for child in node.children() {
        walk_for_inputs(child, fields);
    }
}

fn is_sys_inputs(expr: ast::Expr) -> bool {
    if let ast::Expr::FieldAccess(access) = expr {
        if access.field().as_str() == "inputs" {
            if let ast::Expr::Ident(ident) = access.target() {
                return ident.as_str() == "sys";
            }
        }
    }
    false
}

fn extract_input_field(args: ast::Args, fields: &mut Vec<InputField>) {
    let mut name = None;
    let mut default_value = None;

    for arg in args.items() {
        match arg {
            ast::Arg::Pos(expr) => {
                if name.is_none() {
                    if let ast::Expr::Str(s) = expr {
                        name = Some(s.get().to_string());
                    }
                }
            }
            ast::Arg::Named(named) => {
                if named.name().as_str() == "default" {
                    if let ast::Expr::Str(s) = named.expr() {
                        default_value = Some(s.get().to_string());
                    } else {
                        default_value = Some(named.expr().to_untyped().text().to_string());
                    }
                }
            }
            _ => {}
        }
    }

    if let Some(field_name) = name {
        fields.push(InputField {
            name: field_name,
            required: default_value.is_none(),
            default_value,
        });
    }
}
```

- [ ] **Step 4: Expose discover_inputs via flutter_rust_bridge**

Update the bridge configuration so `discover_inputs` is callable from Dart. The exact mechanism depends on the flutter_rust_bridge version used in the project. Add the function to the same API file that `compileString` uses.

- [ ] **Step 5: Add Dart wrapper**

In `lib/typst_flutter.dart`, add:

```dart
class InputField {
  final String name;
  final bool required;
  final String? defaultValue;

  const InputField({
    required this.name,
    required this.required,
    this.defaultValue,
  });
}

// In TypstFlutter class:
static Future<List<InputField>> discoverInputs(String templateSource) async {
  final result = await api.discoverInputs(source: templateSource);
  return result.map((f) => InputField(
    name: f.name,
    required: f.required,
    defaultValue: f.defaultValue,
  )).toList();
}
```

- [ ] **Step 6: Write test**

Create a test that verifies discover_inputs works:

```dart
test('discovers inputs from template', () async {
  const template = '''
#let name = sys.inputs.at("sender_name")
#let city = sys.inputs.at("sender_city")
#let closing = sys.inputs.at("closing", default: "MfG")

#name from #city

#sys.inputs.at("body")
''';

  final inputs = await TypstFlutter.discoverInputs(template);
  expect(inputs.length, 4);
  expect(inputs[0].name, 'sender_name');
  expect(inputs[0].required, true);
  expect(inputs[2].name, 'closing');
  expect(inputs[2].required, false);
  expect(inputs[2].defaultValue, 'MfG');
});
```

- [ ] **Step 7: Build and verify**

```bash
cd ~/GitHub/typst_flutter
flutter pub get
flutter test
```

Expected: Build succeeds, test passes.

- [ ] **Step 8: Commit and push fork**

```bash
cd ~/GitHub/typst_flutter
git add -A
git commit -m "feat: add discover_inputs API for AST-based sys.inputs extraction"
git push
```

---

### Task 2: Add typst_flutter Fork to MarkdownOffice

**Files:**
- Modify: `pubspec.yaml`

- [ ] **Step 1: Add git dependency**

In `pubspec.yaml`, add:

```yaml
dependencies:
  typst_flutter:
    git:
      url: https://github.com/jcmx9/typst_flutter.git
      ref: main
```

Remove `pdf` package (no longer needed — Typst handles PDF rendering).

- [ ] **Step 2: Install Rust toolchain if not present**

```bash
rustup --version || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

- [ ] **Step 3: Run flutter pub get**

```bash
flutter pub get
```

Expected: Dependencies resolve, Rust code compiles.

- [ ] **Step 4: Verify basic Typst compilation works**

Add a quick smoke test:

```dart
// test/core/typst_smoke_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:typst_flutter/typst_flutter.dart';

void main() {
  test('Typst compiles a simple template', () async {
    await TypstFlutter.init();
    final pdf = await TypstFlutter.compileString(
      template: '= Hello, #sys.inputs.at("name")!',
      inputs: {'name': 'World'},
    );
    expect(pdf, isNotEmpty);
    expect(String.fromCharCodes(pdf.sublist(0, 4)), '%PDF');
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add pubspec.yaml test/core/typst_smoke_test.dart
git commit -m "feat: integrate typst_flutter fork as rendering engine"
```

---

### Task 3: Data Models

**Files:**
- Create: `lib/models/input_field.dart`
- Create: `lib/models/profile.dart`
- Create: `lib/models/config.dart`
- Create: `test/models/profile_test.dart`

- [ ] **Step 1: Write failing test for Profile**

```dart
// test/models/profile_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:markdownoffice/models/profile.dart';

void main() {
  group('Profile', () {
    test('creates from map with all values as strings', () {
      final map = {
        'sender_name': 'Roland Kreus',
        'sender_street': 'Schillerstrasse 20B',
        'sender_zip': 33609,
        'sender_city': 'Bielefeld',
        'sender_phone': '0171/3017808',
      };
      final p = Profile.fromMap('default', map);
      expect(p.name, 'default');
      expect(p.values['sender_zip'], '33609');
      expect(p.values.length, 5);
    });

    test('all values are stored as strings', () {
      final p = Profile.fromMap('test', {'number': 12345, 'flag': true});
      expect(p.values['number'], '12345');
      expect(p.values['flag'], 'true');
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
flutter test test/models/profile_test.dart
```

- [ ] **Step 3: Implement models**

```dart
// lib/models/input_field.dart

class InputField {
  final String name;
  final bool required;
  final String? defaultValue;
  final String? label;  // from sidecar, null = use name as label

  const InputField({
    required this.name,
    required this.required,
    this.defaultValue,
    this.label,
  });

  String get displayLabel => label ?? name;
}
```

```dart
// lib/models/profile.dart

class Profile {
  final String name;
  final Map<String, String> values;

  const Profile({required this.name, required this.values});

  factory Profile.fromMap(String name, Map<String, dynamic> map) {
    final values = <String, String>{};
    for (final entry in map.entries) {
      values[entry.key] = entry.value.toString();
    }
    return Profile(name: name, values: values);
  }
}
```

```dart
// lib/models/config.dart

class AppConfig {
  final String? cloudPath;

  const AppConfig({this.cloudPath});

  factory AppConfig.fromMap(Map<String, dynamic> map) {
    return AppConfig(cloudPath: map['cloud_path']?.toString());
  }
}
```

- [ ] **Step 4: Run tests**

```bash
flutter test test/models/profile_test.dart
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/models/ test/models/
git commit -m "feat: add data models for InputField, Profile, Config"
```

---

### Task 4: Config Loader

**Files:**
- Create: `lib/core/config_loader.dart`
- Create: `test/core/config_loader_test.dart`

- [ ] **Step 1: Write failing tests**

```dart
// test/core/config_loader_test.dart
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:markdownoffice/core/config_loader.dart';

void main() {
  late Directory tempDir;

  setUp(() {
    tempDir = Directory.systemTemp.createTempSync('mdo_test_');
  });

  tearDown(() {
    tempDir.deleteSync(recursive: true);
  });

  group('ConfigLoader', () {
    test('loads config from home path', () {
      final configFile = File('${tempDir.path}/mdo_config.yaml');
      configFile.writeAsStringSync('cloud_path: /some/path');

      final loader = ConfigLoader(homePath: tempDir.path);
      final config = loader.loadConfig();
      expect(config.cloudPath, '/some/path');
    });

    test('returns empty config when file missing', () {
      final loader = ConfigLoader(homePath: tempDir.path);
      final config = loader.loadConfig();
      expect(config.cloudPath, isNull);
    });

    test('loads profiles from home path', () {
      final profilesFile = File('${tempDir.path}/mdo_profiles.yaml');
      profilesFile.writeAsStringSync('''
default:
  sender_name: Test User
  sender_city: Berlin
''');

      final loader = ConfigLoader(homePath: tempDir.path);
      final profiles = loader.loadProfiles();
      expect(profiles, contains('default'));
      expect(profiles['default']!.values['sender_name'], 'Test User');
    });

    test('cwd profiles take priority over home', () {
      final homeProfiles = File('${tempDir.path}/mdo_profiles.yaml');
      homeProfiles.writeAsStringSync('''
default:
  sender_name: Home User
''');

      final cwdDir = Directory('${tempDir.path}/cwd')..createSync();
      final cwdProfiles = File('${cwdDir.path}/mdo_profiles.yaml');
      cwdProfiles.writeAsStringSync('''
default:
  sender_name: CWD User
''');

      final loader = ConfigLoader(homePath: tempDir.path, cwdPath: cwdDir.path);
      final profiles = loader.loadProfiles();
      expect(profiles['default']!.values['sender_name'], 'CWD User');
    });

    test('discovers templates from templates/ subfolder', () {
      final templatesDir = Directory('${tempDir.path}/templates')..createSync();
      File('${templatesDir.path}/din5008_b.typ')
          .writeAsStringSync('#let name = sys.inputs.at("sender_name")');
      File('${templatesDir.path}/elegant.typ')
          .writeAsStringSync('#let name = sys.inputs.at("name")');

      final loader = ConfigLoader(homePath: tempDir.path);
      final templates = loader.listTemplates();
      expect(templates.length, 2);
      expect(templates.any((t) => t.name == 'din5008_b'), isTrue);
    });

    test('loads label sidecar for template', () {
      final templatesDir = Directory('${tempDir.path}/templates')..createSync();
      File('${templatesDir.path}/din5008_b.typ')
          .writeAsStringSync('#let name = sys.inputs.at("sender_name")');
      File('${templatesDir.path}/din5008_b.labels.yaml')
          .writeAsStringSync('sender_name: Name');

      final loader = ConfigLoader(homePath: tempDir.path);
      final labels = loader.loadLabels('din5008_b');
      expect(labels['sender_name'], 'Name');
    });
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
flutter test test/core/config_loader_test.dart
```

- [ ] **Step 3: Implement ConfigLoader**

```dart
// lib/core/config_loader.dart
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

  ConfigLoader({
    required this.homePath,
    this.cwdPath,
    this.cloudPath,
  });

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
        profiles[name] = Profile.fromMap(name, _yamlToMap(entry.value as YamlMap));
      }
    }
    return profiles;
  }

  List<TemplateInfo> listTemplates() {
    final templates = <String, TemplateInfo>{};
    // Reverse order so more specific sources overwrite
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
    return [
      if (cwdPath != null) cwdPath!,
      if (cloudPath != null) cloudPath!,
      homePath,
    ];
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
```

- [ ] **Step 4: Run tests**

```bash
flutter test test/core/config_loader_test.dart
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/core/config_loader.dart test/core/config_loader_test.dart
git commit -m "feat: add config loader with 3-tier lookup for profiles and templates"
```

---

### Task 5: Markdown Parser (for .md import)

**Files:**
- Create: `lib/core/markdown_parser.dart`
- Create: `test/core/markdown_parser_test.dart`

- [ ] **Step 1: Write failing tests**

```dart
// test/core/markdown_parser_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:markdownoffice/core/markdown_parser.dart';

void main() {
  group('splitFrontmatter', () {
    test('splits YAML frontmatter from body', () {
      const input = '''---
template: din5008_b
profile: default
sender_name: Roland Kreus
subject: Kuendigung
date: 2026-04-04
---

Sehr geehrter Herr Mustermann,

hiermit kuendige ich.''';

      final result = splitFrontmatter(input);
      expect(result.frontmatter, contains('template: din5008_b'));
      expect(result.body.trim(), startsWith('Sehr geehrter'));
    });

    test('returns empty frontmatter when none present', () {
      const input = 'Just plain text.';
      final result = splitFrontmatter(input);
      expect(result.frontmatter, isEmpty);
      expect(result.body, 'Just plain text.');
    });
  });

  group('parseFrontmatter', () {
    test('extracts template, profile, and field values', () {
      const yaml = '''
template: din5008_b
profile: default
sender_name: Roland Kreus
subject: Kuendigung
date: 2026-04-04
''';
      final result = parseFrontmatter(yaml);
      expect(result.templateName, 'din5008_b');
      expect(result.profileName, 'default');
      expect(result.fieldValues['sender_name'], 'Roland Kreus');
      expect(result.fieldValues['subject'], 'Kuendigung');
      expect(result.fieldValues.containsKey('template'), false);
      expect(result.fieldValues.containsKey('profile'), false);
    });
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
flutter test test/core/markdown_parser_test.dart
```

- [ ] **Step 3: Implement Markdown parser**

```dart
// lib/core/markdown_parser.dart
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
```

- [ ] **Step 4: Run tests**

```bash
flutter test test/core/markdown_parser_test.dart
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/core/markdown_parser.dart test/core/markdown_parser_test.dart
git commit -m "feat: add markdown parser for frontmatter splitting and import"
```

---

### Task 6: Typst Bridge Wrapper

**Files:**
- Create: `lib/core/typst_bridge.dart`

- [ ] **Step 1: Implement TypstBridge wrapper**

```dart
// lib/core/typst_bridge.dart
import 'dart:typed_data';
import 'package:typst_flutter/typst_flutter.dart' as typst;
import '../models/input_field.dart';

class TypstBridge {
  static bool _initialized = false;

  static Future<void> init() async {
    if (!_initialized) {
      await typst.TypstFlutter.init();
      _initialized = true;
    }
  }

  static Future<List<InputField>> discoverInputs(String templateSource) async {
    final results = await typst.TypstFlutter.discoverInputs(templateSource);
    return results.map((r) => InputField(
      name: r.name,
      required: r.required,
      defaultValue: r.defaultValue,
    )).toList();
  }

  static Future<Uint8List> compile({
    required String templateSource,
    required Map<String, String> inputs,
    List<typst.FontSource> fonts = const [],
    List<typst.ExtraFileSource> files = const [],
  }) async {
    await init();
    return typst.TypstFlutter.compileString(
      template: templateSource,
      inputs: inputs,
      fonts: fonts,
      extraFiles: files,
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/core/typst_bridge.dart
git commit -m "feat: add TypstBridge wrapper for compile and discoverInputs"
```

---

### Task 7: Riverpod Providers

**Files:**
- Create: `lib/providers/config_provider.dart`
- Create: `lib/providers/profile_provider.dart`
- Create: `lib/providers/template_provider.dart`
- Create: `lib/providers/editor_provider.dart`

- [ ] **Step 1: Implement config provider**

```dart
// lib/providers/config_provider.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/config_loader.dart';
import '../models/config.dart';

final configLoaderProvider = Provider<ConfigLoader>((ref) {
  throw UnimplementedError('Override in main with platform-specific paths');
});

final configProvider = Provider<AppConfig>((ref) {
  return ref.read(configLoaderProvider).loadConfig();
});
```

- [ ] **Step 2: Implement profile provider**

```dart
// lib/providers/profile_provider.dart
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
```

- [ ] **Step 3: Implement template provider**

```dart
// lib/providers/template_provider.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/config_loader.dart';
import '../core/typst_bridge.dart';
import '../models/input_field.dart';
import 'config_provider.dart';

final templateListProvider = Provider<List<TemplateInfo>>((ref) {
  return ref.read(configLoaderProvider).listTemplates();
});

final selectedTemplateProvider = StateProvider<TemplateInfo?>((ref) {
  final templates = ref.read(templateListProvider);
  return templates.isNotEmpty ? templates.first : null;
});

final templateSourceProvider = Provider<String?>((ref) {
  final selected = ref.watch(selectedTemplateProvider);
  if (selected == null) return null;
  return ref.read(configLoaderProvider).loadTemplateSource(selected.path);
});

final templateInputsProvider = FutureProvider<List<InputField>>((ref) async {
  final source = ref.watch(templateSourceProvider);
  if (source == null) return [];
  final fields = await TypstBridge.discoverInputs(source);
  final selected = ref.read(selectedTemplateProvider);
  if (selected == null) return fields;
  final labels = ref.read(configLoaderProvider).loadLabels(selected.name);
  return fields.map((f) => InputField(
    name: f.name,
    required: f.required,
    defaultValue: f.defaultValue,
    label: labels[f.name],
  )).toList();
});
```

- [ ] **Step 4: Implement editor provider**

```dart
// lib/providers/editor_provider.dart
import 'dart:typed_data';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/typst_bridge.dart';
import 'template_provider.dart';

final fieldValuesProvider = StateProvider<Map<String, String>>((ref) => {});
final bodyTextProvider = StateProvider<String>((ref) => '');

final pdfBytesProvider = FutureProvider<Uint8List?>((ref) async {
  final source = ref.watch(templateSourceProvider);
  if (source == null) return null;

  final fieldValues = ref.watch(fieldValuesProvider);
  final body = ref.watch(bodyTextProvider);

  final inputs = Map<String, String>.from(fieldValues);
  if (body.isNotEmpty) inputs['body'] = body;

  try {
    return await TypstBridge.compile(
      templateSource: source,
      inputs: inputs,
    );
  } catch (e) {
    return null;
  }
});
```

- [ ] **Step 5: Commit**

```bash
git add lib/providers/
git commit -m "feat: add Riverpod providers for config, profiles, templates, editor state"
```

---

### Task 8: Editor Screen with Dynamic Form

**Files:**
- Create: `lib/features/editor/editor_screen.dart`
- Create: `lib/features/editor/dynamic_form.dart`
- Create: `lib/features/editor/pdf_preview.dart`
- Modify: `lib/main.dart`

- [ ] **Step 1: Implement DynamicForm**

Widget that reads `templateInputsProvider` and generates one TextField per input field. Pre-fills from active profile. Syncs values to `fieldValuesProvider` on change. Body text syncs to `bodyTextProvider`. See spec for details.

- [ ] **Step 2: Implement PdfPreview**

Widget that watches `pdfBytesProvider` and renders via `printing.PdfPreview`. Shows "Bitte Felder ausfuellen." when no PDF available. Shows error message on Typst compilation failure.

- [ ] **Step 3: Implement EditorScreen with responsive layout**

Scaffold with:
- AppBar: Template dropdown, Profile dropdown, Export buttons
- Body: Split-View (wide) or TabView (narrow)
- Drawer: Navigation to Profiles

- [ ] **Step 4: Wire EditorScreen into main.dart**

Initialize TypstBridge, create ConfigLoader with platform-specific paths, wrap app in ProviderScope with configLoaderProvider override.

- [ ] **Step 5: Run and verify**

```bash
flutter run -d macos
```

Expected: App shows editor with dynamic form based on selected template.

- [ ] **Step 6: Commit**

```bash
git add lib/features/editor/ lib/main.dart
git commit -m "feat: add editor screen with dynamic form from Typst template inputs"
```

---

### Task 9: Profile Management Screen

**Files:**
- Create: `lib/features/profiles/profiles_screen.dart`
- Create: `lib/features/profiles/profile_editor.dart`

- [ ] **Step 1: Implement ProfilesScreen**

List of all profiles from `profilesProvider`. Tap to edit. FAB to create new.

- [ ] **Step 2: Implement ProfileEditor**

Form with key-value fields for profile data. Profile name field. Save writes to `mdo_profiles.yaml`.

- [ ] **Step 3: Commit**

```bash
git add lib/features/profiles/
git commit -m "feat: add profile management screens"
```

---

### Task 10: Export (Save, Share, Print)

**Files:**
- Modify: `lib/features/editor/editor_screen.dart`

- [ ] **Step 1: Add export actions to AppBar**

Save (FilePicker → write PDF), Share (Printing.sharePdf), Print (Printing.layoutPdf).

- [ ] **Step 2: Commit**

```bash
git add lib/features/editor/editor_screen.dart
git commit -m "feat: add PDF export with save, share, and print"
```

---

### Task 11: DIN 5008 Form B Typst Template

**Files:**
- Create: `assets/templates/din5008_b.typ`
- Create: `assets/templates/din5008_b.labels.yaml`
- Modify: `pubspec.yaml` (register assets)

- [ ] **Step 1: Write DIN 5008 Form B template**

Full Typst template implementing DIN 5008 Form B layout: sender block (right, 55mm), return address line, recipient block, fold marks, date, subject, body, closing, signature space, attachments, footer with contact/page number. Uses `sys.inputs.at(...)` for all variable data. Body rendered via Typst content insertion.

- [ ] **Step 2: Write labels sidecar**

```yaml
# assets/templates/din5008_b.labels.yaml
sender_name: Name
sender_street: Strasse
sender_zip: PLZ
sender_city: Ort
sender_phone: Telefon
sender_email: E-Mail
recipient_name: Empfaenger
recipient_extra: Zusatz
recipient_street: Strasse
recipient_zip: PLZ
recipient_city: Ort
subject: Betreff
date: Datum
closing: Schlussformel
body: Brieftext
attachments: Anlagen
```

- [ ] **Step 3: Register assets in pubspec.yaml**

```yaml
flutter:
  assets:
    - assets/templates/
    - assets/fonts/
```

- [ ] **Step 4: Commit**

```bash
git add assets/templates/din5008_b.typ assets/templates/din5008_b.labels.yaml pubspec.yaml
git commit -m "feat: add DIN 5008 Form B Typst template with label sidecar"
```

---

### Task 12: Elegant Template (Korrespondenz-Stil)

**Files:**
- Create: `assets/templates/elegant.typ`
- Create: `assets/templates/elegant.labels.yaml`

- [ ] **Step 1: Write Elegant template**

Based on the Korrespondenz2.pdf reference: centered header with sender name in burgundy small caps, cream background, return address line, recipient block, fold marks, reference + date on same line, indented body paragraphs, closing, signature, cc field, attachments. Page number bottom right. Header repeats on all pages.

- [ ] **Step 2: Write labels sidecar**

Labels for all fields including `reference`, `cc`.

- [ ] **Step 3: Commit**

```bash
git add assets/templates/elegant.typ assets/templates/elegant.labels.yaml
git commit -m "feat: add Elegant Typst template (Korrespondenz style)"
```

---

### Task 13: Integration Test

**Files:**
- Create: `test/integration/full_pipeline_test.dart`

- [ ] **Step 1: Write integration test**

Test the full pipeline: discover inputs from template → parse markdown import → compile to PDF. Verify PDF starts with `%PDF`, has reasonable size.

- [ ] **Step 2: Run all tests**

```bash
flutter test
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add test/integration/
git commit -m "test: add full pipeline integration test"
```

---

### Task 14: Final Cleanup and Verification

- [ ] **Step 1: Run dart analyze**

```bash
dart analyze
```

- [ ] **Step 2: Run dart format**

```bash
dart format .
```

- [ ] **Step 3: Run all tests**

```bash
flutter test
```

- [ ] **Step 4: Build for macOS**

```bash
flutter build macos
```

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "chore: format code and fix analysis warnings"
git push
```
