import 'package:flutter_test/flutter_test.dart';
import 'package:markdownoffice/core/markdown_parser.dart';

void main() {
  group('splitFrontmatter', () {
    test('splits YAML frontmatter from body', () {
      const input =
          '---\ntemplate: din5008_b\nprofile: default\nsubject: Test\n---\n\nBody text.';
      final result = splitFrontmatter(input);
      expect(result.frontmatter, contains('template: din5008_b'));
      expect(result.body.trim(), 'Body text.');
    });

    test('returns empty frontmatter when none present', () {
      const input = 'Just plain text.';
      final result = splitFrontmatter(input);
      expect(result.frontmatter, isEmpty);
      expect(result.body, 'Just plain text.');
    });

    test('handles missing closing delimiter', () {
      const input = '---\ntemplate: test\nNo closing delimiter';
      final result = splitFrontmatter(input);
      expect(result.frontmatter, isEmpty);
    });
  });

  group('parseFrontmatter', () {
    test('extracts template, profile, and field values', () {
      const yaml =
          'template: din5008_b\nprofile: default\nsender_name: Roland\nsubject: Test\ndate: 2026-04-04';
      final result = parseFrontmatter(yaml);
      expect(result.templateName, 'din5008_b');
      expect(result.profileName, 'default');
      expect(result.fieldValues['sender_name'], 'Roland');
      expect(result.fieldValues['subject'], 'Test');
      expect(result.fieldValues.containsKey('template'), false);
      expect(result.fieldValues.containsKey('profile'), false);
    });

    test('handles empty yaml', () {
      final result = parseFrontmatter('');
      expect(result.templateName, isNull);
      expect(result.fieldValues, isEmpty);
    });

    test('converts numeric values to strings', () {
      const yaml = 'zip: 33609\ndate: 2026-04-04';
      final result = parseFrontmatter(yaml);
      expect(result.fieldValues['zip'], '33609');
    });
  });
}
