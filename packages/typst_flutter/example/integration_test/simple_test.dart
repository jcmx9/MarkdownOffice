import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:typst_flutter/typst_flutter.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() async {
    await TypstFlutter.init();
  });
  // ── compile ───────────────────────────────────────────────────────────────

  group('TypstFlutter.compileString()', () {
    test('returns valid PDF with simple template', () async {
      final pdf = await TypstFlutter.compileString(template: '= Hello Typst!');

      expect(pdf, isNotEmpty);
      // Magic bytes %PDF
      expect(pdf.sublist(0, 4), equals([0x25, 0x50, 0x44, 0x46]));
    });

    test('accepts inputs map and injects as sys.inputs', () async {
      const template = '''
= #sys.inputs.at("title", default: "")
''';
      final pdf = await TypstFlutter.compileString(
        template: template,
        inputs: {'title': 'Test Report'},
      );

      expect(pdf, isNotEmpty);
      expect(pdf.sublist(0, 4), equals([0x25, 0x50, 0x44, 0x46]));
    });

    test('null inputs does not throw', () async {
      final pdf = await TypstFlutter.compileString(
        template: '= Fixed Title',
        inputs: null,
      );
      expect(pdf, isNotEmpty);
    });

    test('inputs with multiple keys works', () async {
      const template = '''
= #sys.inputs.at("name", default: "")

Author: #sys.inputs.at("author", default: "")
''';
      final pdf = await TypstFlutter.compileString(
        template: template,
        inputs: {'name': 'My Document', 'author': 'John'},
      );
      expect(pdf, isNotEmpty);
    });

    test('empty fonts does not throw', () async {
      final pdf = await TypstFlutter.compileString(
        template: '= No extra fonts',
        fonts: [],
      );
      expect(pdf, isNotEmpty);
    });

    test('empty extraFiles does not throw', () async {
      final pdf = await TypstFlutter.compileString(
        template: '= No extra files',
        extraFiles: [],
      );
      expect(pdf, isNotEmpty);
    });

    test('invalid Typst template throws exception', () async {
      await expectLater(
        () => TypstFlutter.compileString(template: '#nonexistent_function()'),
        throwsException,
      );
    });

    test('larger template produces larger PDF', () async {
      final small = await TypstFlutter.compileString(template: '= A');
      final large = await TypstFlutter.compileString(
        template: List.generate(
          30,
          (i) => '== Section $i\n\n${'Paragraph text for section $i. ' * 10}\n',
        ).join('\n'),
      );

      expect(large.length, greaterThan(small.length));
    });
  });

  // ── compileAsset ───────────────────────────────────────────────────────────

  group('TypstFlutter.compileAsset()', () {
    test('throws exception for non-existent asset', () async {
      await expectLater(
        () => TypstFlutter.compileAsset(
          assetPath: 'assets/templates/does_not_exist.typ',
        ),
        throwsA(anything),
      );
    });

    test('compiles asset from templates folder', () async {
      final pdf = await TypstFlutter.compileAsset(
        assetPath: 'assets/templates/test.typ',
        inputs: {'author': 'Test Author', 'date': '2024-01-01'},
        fonts: const [],
      );
      expect(pdf, isNotEmpty);
      expect(pdf.sublist(0, 4), equals([0x25, 0x50, 0x44, 0x46]));
    });
  });
}
