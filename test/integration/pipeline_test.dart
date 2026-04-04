import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:markdownoffice/core/markdown_parser.dart';
import 'package:markdownoffice/core/config_loader.dart';
import 'package:markdownoffice/models/profile.dart';

void main() {
  group('Full pipeline (pure Dart)', () {
    test('markdown import → parse frontmatter → extract fields', () {
      const markdown = '''---
template: din5008_b
profile: default
sender_name: Roland Kreus
recipient_name: Max Mustermann
subject: Kuendigung
date: 2026-04-04
---

Sehr geehrter Herr Mustermann,

hiermit kuendige ich.''';

      final split = splitFrontmatter(markdown);
      expect(split.frontmatter, contains('template: din5008_b'));
      expect(split.body.trim(), startsWith('Sehr geehrter'));

      final fm = parseFrontmatter(split.frontmatter);
      expect(fm.templateName, 'din5008_b');
      expect(fm.profileName, 'default');
      expect(fm.fieldValues['sender_name'], 'Roland Kreus');
      expect(fm.fieldValues['recipient_name'], 'Max Mustermann');
      expect(fm.fieldValues['subject'], 'Kuendigung');
    });

    test('profile values merge with frontmatter (frontmatter wins)', () {
      final profile = Profile.fromMap('default', {
        'sender_name': 'Profile Name',
        'sender_city': 'Berlin',
      });

      final frontmatterValues = {
        'sender_name': 'Frontmatter Name',
        'subject': 'Test',
      };

      // Merge: profile as base, frontmatter overrides
      final merged = Map<String, String>.from(profile.values);
      merged.addAll(frontmatterValues);

      expect(merged['sender_name'], 'Frontmatter Name'); // frontmatter wins
      expect(merged['sender_city'], 'Berlin'); // from profile
      expect(merged['subject'], 'Test'); // from frontmatter
    });

    test('config loader finds templates in temp directory', () {
      final tempDir = Directory.systemTemp.createTempSync('mdo_integration_');
      try {
        final tDir = Directory('${tempDir.path}/templates')..createSync();
        File(
          '${tDir.path}/test_template.typ',
        ).writeAsStringSync('#let name = sys.inputs.at("sender_name")\n#name');

        final loader = ConfigLoader(homePath: tempDir.path);
        final templates = loader.listTemplates();
        expect(templates.length, 1);
        expect(templates.first.name, 'test_template');

        final source = loader.loadTemplateSource(templates.first.path);
        expect(source, contains('sys.inputs.at'));
      } finally {
        tempDir.deleteSync(recursive: true);
      }
    });

    test('config loader loads labels sidecar', () {
      final tempDir = Directory.systemTemp.createTempSync('mdo_integration_');
      try {
        final tDir = Directory('${tempDir.path}/templates')..createSync();
        File('${tDir.path}/test.typ').writeAsStringSync('#let x = 1');
        File(
          '${tDir.path}/test.labels.yaml',
        ).writeAsStringSync('sender_name: Name\nsubject: Betreff');

        final loader = ConfigLoader(homePath: tempDir.path);
        final labels = loader.loadLabels('test');
        expect(labels['sender_name'], 'Name');
        expect(labels['subject'], 'Betreff');
      } finally {
        tempDir.deleteSync(recursive: true);
      }
    });
  });
}
