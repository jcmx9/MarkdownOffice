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
      File('${tempDir.path}/mdo_config.yaml')
          .writeAsStringSync('cloud_path: /some/path');
      final loader = ConfigLoader(homePath: tempDir.path);
      expect(loader.loadConfig().cloudPath, '/some/path');
    });

    test('returns empty config when file missing', () {
      final loader = ConfigLoader(homePath: tempDir.path);
      expect(loader.loadConfig().cloudPath, isNull);
    });

    test('loads profiles from home path', () {
      File('${tempDir.path}/mdo_profiles.yaml').writeAsStringSync(
        'default:\n  sender_name: Test User\n  sender_city: Berlin\n',
      );
      final loader = ConfigLoader(homePath: tempDir.path);
      final profiles = loader.loadProfiles();
      expect(profiles['default']!.values['sender_name'], 'Test User');
    });

    test('cwd profiles take priority over home', () {
      File('${tempDir.path}/mdo_profiles.yaml').writeAsStringSync(
        'default:\n  sender_name: Home User\n',
      );
      final cwdDir = Directory('${tempDir.path}/cwd')..createSync();
      File('${cwdDir.path}/mdo_profiles.yaml').writeAsStringSync(
        'default:\n  sender_name: CWD User\n',
      );
      final loader = ConfigLoader(homePath: tempDir.path, cwdPath: cwdDir.path);
      expect(loader.loadProfiles()['default']!.values['sender_name'], 'CWD User');
    });

    test('discovers templates from templates/ subfolder', () {
      final tDir = Directory('${tempDir.path}/templates')..createSync();
      File('${tDir.path}/din5008_b.typ').writeAsStringSync('#let x = 1');
      File('${tDir.path}/elegant.typ').writeAsStringSync('#let y = 2');
      final loader = ConfigLoader(homePath: tempDir.path);
      final templates = loader.listTemplates();
      expect(templates.length, 2);
      expect(templates.any((t) => t.name == 'din5008_b'), isTrue);
    });

    test('loads label sidecar for template', () {
      final tDir = Directory('${tempDir.path}/templates')..createSync();
      File('${tDir.path}/din5008_b.typ').writeAsStringSync('#let x = 1');
      File('${tDir.path}/din5008_b.labels.yaml').writeAsStringSync('sender_name: Name\nsubject: Betreff');
      final loader = ConfigLoader(homePath: tempDir.path);
      final labels = loader.loadLabels('din5008_b');
      expect(labels['sender_name'], 'Name');
      expect(labels['subject'], 'Betreff');
    });

    test('returns empty labels when no sidecar exists', () {
      final loader = ConfigLoader(homePath: tempDir.path);
      expect(loader.loadLabels('nonexistent'), isEmpty);
    });
  });
}
