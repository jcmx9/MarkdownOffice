# MarkdownOffice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform Flutter app that generates DIN 5008-compliant business letters from Markdown, with template-based layout and a privacy-first web variant.

**Architecture:** Feature-based structure with isolated core modules (parser, template engine, PDF renderer, config loader). Riverpod for state management. Native app has full YAML-based config/profiles/templates with 3-tier file lookup. Web app stores profiles in LocalStorage with a single built-in DIN 5008 Form B template.

**Tech Stack:** Flutter, Dart, `pdf` package, `markdown` package, `yaml` package, `qr_flutter`, `flutter_riverpod`, `file_picker`, Docker + nginx for web deployment.

---

### Task 1: Flutter Project Scaffold

**Files:**
- Create: `pubspec.yaml`
- Create: `lib/main.dart`
- Create: `test/widget_test.dart`
- Create: `Dockerfile`
- Create: `.gitignore`

- [ ] **Step 1: Create Flutter project**

```bash
flutter create --project-name markdownoffice --org com.markdownoffice .
```

This generates the standard Flutter scaffold. The `--org` sets the reverse domain for platform bundles.

- [ ] **Step 2: Clean up generated code**

Replace `lib/main.dart` with a minimal app shell:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  runApp(const ProviderScope(child: MarkdownOfficeApp()));
}

class MarkdownOfficeApp extends StatelessWidget {
  const MarkdownOfficeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MarkdownOffice',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.blueGrey),
        useMaterial3: true,
      ),
      home: const Scaffold(
        body: Center(child: Text('MarkdownOffice')),
      ),
    );
  }
}
```

- [ ] **Step 3: Add dependencies to pubspec.yaml**

Add under `dependencies`:

```yaml
dependencies:
  flutter:
    sdk: flutter
  flutter_riverpod: ^2.6.1
  pdf: ^3.11.1
  markdown: ^7.2.2
  yaml: ^3.1.3
  qr_flutter: ^4.1.0
  file_picker: ^8.1.6
  path_provider: ^2.1.5
  path: ^1.9.1
  printing: ^5.13.4
  share_plus: ^10.1.4

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^5.0.0
```

- [ ] **Step 4: Run flutter pub get**

```bash
flutter pub get
```

Expected: Dependencies resolve successfully.

- [ ] **Step 5: Create Dockerfile**

```dockerfile
FROM ghcr.io/cirruslabs/flutter:stable AS build
WORKDIR /app
COPY . .
RUN flutter pub get
RUN flutter build web --release

FROM nginx:alpine
COPY --from=build /app/build/web /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

- [ ] **Step 6: Update .gitignore**

Ensure `.gitignore` includes:

```
build/
.dart_tool/
.packages
pubspec.lock
*.iml
.idea/
.vscode/
*.swp
```

- [ ] **Step 7: Run tests and verify**

```bash
flutter test
flutter analyze
```

Expected: Clean test run, no analysis errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: initialize Flutter project with dependencies and Dockerfile"
```

---

### Task 2: Data Models

**Files:**
- Create: `lib/models/letter.dart`
- Create: `lib/models/profile.dart`
- Create: `lib/models/template.dart`
- Create: `lib/models/config.dart`
- Create: `test/models/letter_test.dart`
- Create: `test/models/profile_test.dart`
- Create: `test/models/template_test.dart`

- [ ] **Step 1: Write failing tests for Letter and Recipient models**

```dart
// test/models/letter_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:markdownoffice/models/letter.dart';

void main() {
  group('Recipient', () {
    test('creates with required fields', () {
      final r = Recipient(
        name: 'Max Mustermann',
        street: 'Beispielweg 5',
        zip: '10115',
        city: 'Berlin',
      );
      expect(r.name, 'Max Mustermann');
      expect(r.extra, isNull);
    });

    test('creates with optional extra field', () {
      final r = Recipient(
        name: 'Max Mustermann',
        extra: 'Abteilung IT',
        street: 'Beispielweg 5',
        zip: '10115',
        city: 'Berlin',
      );
      expect(r.extra, 'Abteilung IT');
    });
  });

  group('Letter', () {
    test('creates with required fields and defaults', () {
      final letter = Letter(
        profile: 'default',
        recipient: Recipient(
          name: 'Max Mustermann',
          street: 'Beispielweg 5',
          zip: '10115',
          city: 'Berlin',
        ),
        subject: 'Kuendigung',
        date: DateTime(2026, 4, 4),
      );
      expect(letter.closing, 'Mit freundlichen Gruessen');
      expect(letter.sign, false);
      expect(letter.attachments, isEmpty);
    });

    test('creates from Map with string values', () {
      final map = {
        'profile': 'default',
        'recipient': {
          'name': 'Max Mustermann',
          'street': 'Beispielweg 5',
          'zip': 10115,
          'city': 'Berlin',
        },
        'subject': 'Kuendigung',
        'date': '2026-04-04',
        'attachments': ['Anlage 1'],
      };
      final letter = Letter.fromMap(map);
      expect(letter.recipient.zip, '10115');
      expect(letter.date, DateTime(2026, 4, 4));
      expect(letter.attachments, ['Anlage 1']);
    });
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
flutter test test/models/letter_test.dart
```

Expected: FAIL — `letter.dart` does not exist.

- [ ] **Step 3: Implement Letter and Recipient models**

```dart
// lib/models/letter.dart

class Recipient {
  final String name;
  final String? extra;
  final String street;
  final String zip;
  final String city;

  const Recipient({
    required this.name,
    this.extra,
    required this.street,
    required this.zip,
    required this.city,
  });

  factory Recipient.fromMap(Map<String, dynamic> map) {
    return Recipient(
      name: map['name'].toString(),
      extra: map['extra']?.toString(),
      street: map['street'].toString(),
      zip: map['zip'].toString(),
      city: map['city'].toString(),
    );
  }
}

class Letter {
  final String profile;
  final Recipient recipient;
  final String subject;
  final DateTime date;
  final String closing;
  final bool sign;
  final List<String> attachments;

  const Letter({
    required this.profile,
    required this.recipient,
    required this.subject,
    required this.date,
    this.closing = 'Mit freundlichen Gruessen',
    this.sign = false,
    this.attachments = const [],
  });

  factory Letter.fromMap(Map<String, dynamic> map) {
    final dateValue = map['date'];
    DateTime parsedDate;
    if (dateValue is DateTime) {
      parsedDate = dateValue;
    } else {
      parsedDate = DateTime.parse(dateValue.toString());
    }

    return Letter(
      profile: map['profile'].toString(),
      recipient: Recipient.fromMap(
        Map<String, dynamic>.from(map['recipient'] as Map),
      ),
      subject: map['subject'].toString(),
      date: parsedDate,
      closing: map['closing']?.toString() ?? 'Mit freundlichen Gruessen',
      sign: map['sign'] as bool? ?? false,
      attachments: (map['attachments'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList() ??
          [],
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
flutter test test/models/letter_test.dart
```

Expected: All tests PASS.

- [ ] **Step 5: Write failing tests for Profile and Bank models**

```dart
// test/models/profile_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:markdownoffice/models/profile.dart';

void main() {
  group('Bank', () {
    test('creates from map', () {
      final bank = Bank.fromMap({
        'holder': 'Roland Kreus',
        'iban': 'DE89370400440532013000',
        'bic': 'COBADEFFXXX',
        'bank_name': 'Commerzbank',
      });
      expect(bank.holder, 'Roland Kreus');
      expect(bank.iban, 'DE89370400440532013000');
    });
  });

  group('Profile', () {
    test('creates with required fields and defaults', () {
      final p = Profile(
        name: 'Roland Kreus',
        street: 'Musterstr. 1',
        zip: '12345',
        city: 'Berlin',
      );
      expect(p.template, 'din5008_b');
      expect(p.signatureHeight, 15.0);
      expect(p.printQr, true);
      expect(p.bank, isNull);
    });

    test('creates from map with all values as strings', () {
      final map = {
        'name': 'Roland Kreus',
        'street': 'Musterstr. 1',
        'zip': 12345,
        'city': 'Berlin',
        'email': 'mail@example.com',
        'template': 'din5008_b',
        'signature_height': '15mm',
        'print_qr': true,
      };
      final p = Profile.fromMap(map);
      expect(p.zip, '12345');
      expect(p.signatureHeight, 15.0);
    });

    test('parses signature_height with mm suffix', () {
      final p = Profile.fromMap({
        'name': 'Test',
        'street': 'S',
        'zip': '1',
        'city': 'C',
        'signature_height': '12mm',
      });
      expect(p.signatureHeight, 12.0);
    });

    test('parses signature_height as number', () {
      final p = Profile.fromMap({
        'name': 'Test',
        'street': 'S',
        'zip': '1',
        'city': 'C',
        'signature_height': 10,
      });
      expect(p.signatureHeight, 10.0);
    });
  });
}
```

- [ ] **Step 6: Run tests to verify they fail**

```bash
flutter test test/models/profile_test.dart
```

Expected: FAIL — `profile.dart` does not exist.

- [ ] **Step 7: Implement Profile and Bank models**

```dart
// lib/models/profile.dart

class Bank {
  final String holder;
  final String iban;
  final String bic;
  final String bankName;

  const Bank({
    required this.holder,
    required this.iban,
    required this.bic,
    required this.bankName,
  });

  factory Bank.fromMap(Map<String, dynamic> map) {
    return Bank(
      holder: map['holder'].toString(),
      iban: map['iban'].toString(),
      bic: map['bic'].toString(),
      bankName: map['bank_name'].toString(),
    );
  }
}

class Profile {
  final String name;
  final String street;
  final String zip;
  final String city;
  final String? phone;
  final String? email;
  final Bank? bank;
  final String? signature;
  final double signatureHeight;
  final bool printQr;
  final String template;

  const Profile({
    required this.name,
    required this.street,
    required this.zip,
    required this.city,
    this.phone,
    this.email,
    this.bank,
    this.signature,
    this.signatureHeight = 15.0,
    this.printQr = true,
    this.template = 'din5008_b',
  });

  factory Profile.fromMap(Map<String, dynamic> map) {
    return Profile(
      name: map['name'].toString(),
      street: map['street'].toString(),
      zip: map['zip'].toString(),
      city: map['city'].toString(),
      phone: map['phone']?.toString(),
      email: map['email']?.toString(),
      bank: map['bank'] != null
          ? Bank.fromMap(Map<String, dynamic>.from(map['bank'] as Map))
          : null,
      signature: map['signature']?.toString(),
      signatureHeight: _parseSignatureHeight(map['signature_height']),
      printQr: map['print_qr'] as bool? ?? true,
      template: map['template']?.toString() ?? 'din5008_b',
    );
  }

  static double _parseSignatureHeight(dynamic value) {
    if (value == null) return 15.0;
    if (value is num) return value.toDouble();
    final str = value.toString().replaceAll('mm', '').trim();
    return double.tryParse(str) ?? 15.0;
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
flutter test test/models/profile_test.dart
```

Expected: All tests PASS.

- [ ] **Step 9: Write failing tests for Template model**

```dart
// test/models/template_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:markdownoffice/models/template.dart';

void main() {
  group('LetterTemplate', () {
    test('creates DIN 5008 Form B from map', () {
      final map = {
        'description': 'DIN 5008 Form B',
        'page': {'width': 210, 'height': 297},
        'margins': {'top': 20, 'bottom': 20, 'left': 25, 'right': 20},
        'positions': {
          'header': 45,
          'return_address': 62.6,
          'address_field': 63.6,
          'body': 103.6,
          'fold_mark_1': 105,
          'hole_mark': 148.5,
          'fold_mark_2': 210,
        },
        'typography': {
          'font_body': 'Source Serif 4',
          'font_ui': 'Source Sans 3',
          'font_mono': 'Source Code Pro',
          'font_size': 11,
          'line_height': 1.15,
          'color_gray': '#808080',
        },
        'footer': {'lines': 3, 'separator': '\u25AA'},
        'signature': {'max_height': 15},
        'qr_code': {'size': 18},
      };
      final t = LetterTemplate.fromMap(map);
      expect(t.positions.header, 45.0);
      expect(t.positions.addressField, 63.6);
      expect(t.positions.body, 103.6);
      expect(t.margins.left, 25.0);
      expect(t.typography.fontSize, 11.0);
      expect(t.typography.lineHeight, 1.15);
      expect(t.footer.separator, '\u25AA');
      expect(t.qrCode.size, 18.0);
    });

    test('lineHeightMm calculates correctly', () {
      final map = {
        'description': 'Test',
        'page': {'width': 210, 'height': 297},
        'margins': {'top': 20, 'bottom': 20, 'left': 25, 'right': 20},
        'positions': {
          'header': 45, 'return_address': 62.6, 'address_field': 63.6,
          'body': 103.6, 'fold_mark_1': 105, 'hole_mark': 148.5,
          'fold_mark_2': 210,
        },
        'typography': {
          'font_body': 'F', 'font_ui': 'F', 'font_mono': 'F',
          'font_size': 11, 'line_height': 1.15, 'color_gray': '#808080',
        },
        'footer': {'lines': 3, 'separator': '.'},
        'signature': {'max_height': 15},
        'qr_code': {'size': 18},
      };
      final t = LetterTemplate.fromMap(map);
      // 11pt * 0.3528 mm/pt * 1.15 = ~4.463mm
      expect(t.lineHeightMm, closeTo(4.463, 0.001));
    });

    test('effectivePageWidth calculates correctly', () {
      final map = {
        'description': 'Test',
        'page': {'width': 210, 'height': 297},
        'margins': {'top': 20, 'bottom': 20, 'left': 25, 'right': 20},
        'positions': {
          'header': 45, 'return_address': 62.6, 'address_field': 63.6,
          'body': 103.6, 'fold_mark_1': 105, 'hole_mark': 148.5,
          'fold_mark_2': 210,
        },
        'typography': {
          'font_body': 'F', 'font_ui': 'F', 'font_mono': 'F',
          'font_size': 11, 'line_height': 1.15, 'color_gray': '#808080',
        },
        'footer': {'lines': 3, 'separator': '.'},
        'signature': {'max_height': 15},
        'qr_code': {'size': 18},
      };
      final t = LetterTemplate.fromMap(map);
      // 210 - 25 - 20 = 165mm
      expect(t.effectivePageWidth, 165.0);
    });
  });
}
```

- [ ] **Step 10: Run tests to verify they fail**

```bash
flutter test test/models/template_test.dart
```

Expected: FAIL — `template.dart` does not exist.

- [ ] **Step 11: Implement Template model**

```dart
// lib/models/template.dart

class PageSize {
  final double width;
  final double height;

  const PageSize({required this.width, required this.height});

  factory PageSize.fromMap(Map<String, dynamic> map) {
    return PageSize(
      width: (map['width'] as num).toDouble(),
      height: (map['height'] as num).toDouble(),
    );
  }
}

class Margins {
  final double top;
  final double bottom;
  final double left;
  final double right;

  const Margins({
    required this.top,
    required this.bottom,
    required this.left,
    required this.right,
  });

  factory Margins.fromMap(Map<String, dynamic> map) {
    return Margins(
      top: (map['top'] as num).toDouble(),
      bottom: (map['bottom'] as num).toDouble(),
      left: (map['left'] as num).toDouble(),
      right: (map['right'] as num).toDouble(),
    );
  }
}

class Positions {
  final double header;
  final double returnAddress;
  final double addressField;
  final double body;
  final double foldMark1;
  final double holeMark;
  final double foldMark2;

  const Positions({
    required this.header,
    required this.returnAddress,
    required this.addressField,
    required this.body,
    required this.foldMark1,
    required this.holeMark,
    required this.foldMark2,
  });

  factory Positions.fromMap(Map<String, dynamic> map) {
    return Positions(
      header: (map['header'] as num).toDouble(),
      returnAddress: (map['return_address'] as num).toDouble(),
      addressField: (map['address_field'] as num).toDouble(),
      body: (map['body'] as num).toDouble(),
      foldMark1: (map['fold_mark_1'] as num).toDouble(),
      holeMark: (map['hole_mark'] as num).toDouble(),
      foldMark2: (map['fold_mark_2'] as num).toDouble(),
    );
  }
}

class Typography {
  final String fontBody;
  final String fontUi;
  final String fontMono;
  final double fontSize;
  final double lineHeight;
  final String colorGray;

  const Typography({
    required this.fontBody,
    required this.fontUi,
    required this.fontMono,
    required this.fontSize,
    required this.lineHeight,
    required this.colorGray,
  });

  factory Typography.fromMap(Map<String, dynamic> map) {
    return Typography(
      fontBody: map['font_body'].toString(),
      fontUi: map['font_ui'].toString(),
      fontMono: map['font_mono'].toString(),
      fontSize: (map['font_size'] as num).toDouble(),
      lineHeight: (map['line_height'] as num).toDouble(),
      colorGray: map['color_gray'].toString(),
    );
  }
}

class Footer {
  final int lines;
  final String separator;

  const Footer({required this.lines, required this.separator});

  factory Footer.fromMap(Map<String, dynamic> map) {
    return Footer(
      lines: map['lines'] as int,
      separator: map['separator'].toString(),
    );
  }
}

class SignatureConfig {
  final double maxHeight;

  const SignatureConfig({required this.maxHeight});

  factory SignatureConfig.fromMap(Map<String, dynamic> map) {
    return SignatureConfig(maxHeight: (map['max_height'] as num).toDouble());
  }
}

class QrCodeConfig {
  final double size;

  const QrCodeConfig({required this.size});

  factory QrCodeConfig.fromMap(Map<String, dynamic> map) {
    return QrCodeConfig(size: (map['size'] as num).toDouble());
  }
}

class LetterTemplate {
  final String description;
  final PageSize page;
  final Margins margins;
  final Positions positions;
  final Typography typography;
  final Footer footer;
  final SignatureConfig signature;
  final QrCodeConfig qrCode;

  const LetterTemplate({
    required this.description,
    required this.page,
    required this.margins,
    required this.positions,
    required this.typography,
    required this.footer,
    required this.signature,
    required this.qrCode,
  });

  /// Line height in mm: font_size_pt * 0.3528 mm/pt * line_height_factor
  double get lineHeightMm => typography.fontSize * 0.3528 * typography.lineHeight;

  /// Effective page width: page_width - margin_left - margin_right
  double get effectivePageWidth => page.width - margins.left - margins.right;

  factory LetterTemplate.fromMap(Map<String, dynamic> map) {
    return LetterTemplate(
      description: map['description'].toString(),
      page: PageSize.fromMap(Map<String, dynamic>.from(map['page'] as Map)),
      margins: Margins.fromMap(Map<String, dynamic>.from(map['margins'] as Map)),
      positions: Positions.fromMap(Map<String, dynamic>.from(map['positions'] as Map)),
      typography: Typography.fromMap(Map<String, dynamic>.from(map['typography'] as Map)),
      footer: Footer.fromMap(Map<String, dynamic>.from(map['footer'] as Map)),
      signature: SignatureConfig.fromMap(Map<String, dynamic>.from(map['signature'] as Map)),
      qrCode: QrCodeConfig.fromMap(Map<String, dynamic>.from(map['qr_code'] as Map)),
    );
  }
}
```

- [ ] **Step 12: Implement Config model**

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

- [ ] **Step 13: Run all model tests**

```bash
flutter test test/models/
```

Expected: All tests PASS.

- [ ] **Step 14: Commit**

```bash
git add lib/models/ test/models/
git commit -m "feat: add data models for Letter, Profile, Template, Config"
```

---

### Task 3: Markdown Parser

**Files:**
- Create: `lib/core/markdown_parser.dart`
- Create: `test/core/markdown_parser_test.dart`

- [ ] **Step 1: Write failing tests for frontmatter splitting and body parsing**

```dart
// test/core/markdown_parser_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:markdownoffice/core/markdown_parser.dart';
import 'package:markdownoffice/models/letter.dart';

void main() {
  group('splitFrontmatter', () {
    test('splits YAML frontmatter from body', () {
      const input = '''---
profile: default
recipient:
  name: Max Mustermann
  street: Beispielweg 5
  zip: 10115
  city: Berlin
subject: Kuendigung
date: 2026-04-04
---

Sehr geehrter Herr Mustermann,

hiermit kuendige ich.''';

      final result = splitFrontmatter(input);
      expect(result.yaml, contains('profile: default'));
      expect(result.body.trim(), startsWith('Sehr geehrter'));
    });

    test('returns empty yaml when no frontmatter', () {
      const input = 'Just plain text.';
      final result = splitFrontmatter(input);
      expect(result.yaml, isEmpty);
      expect(result.body, 'Just plain text.');
    });
  });

  group('parseLetter', () {
    test('parses frontmatter into Letter', () {
      const input = '''---
profile: default
recipient:
  name: Max Mustermann
  street: Beispielweg 5
  zip: 10115
  city: Berlin
subject: Kuendigung
date: 2026-04-04
---

Body text.''';

      final result = parseLetter(input);
      expect(result.letter.profile, 'default');
      expect(result.letter.recipient.name, 'Max Mustermann');
      expect(result.letter.recipient.zip, '10115');
      expect(result.letter.subject, 'Kuendigung');
      expect(result.body.trim(), 'Body text.');
    });
  });

  group('renderMarkdown', () {
    test('parses paragraph', () {
      final elements = renderMarkdown('Hello world.');
      expect(elements, hasLength(1));
      expect(elements[0].type, ElementType.paragraph);
      expect(elements[0].runs[0].text, contains('Hello'));
    });

    test('parses bold text', () {
      final elements = renderMarkdown('Hello **bold** world.');
      expect(elements, hasLength(1));
      final runs = elements[0].runs;
      expect(runs.any((r) => r.bold && r.text.contains('bold')), isTrue);
    });

    test('parses italic text', () {
      final elements = renderMarkdown('Hello *italic* world.');
      expect(elements, hasLength(1));
      final runs = elements[0].runs;
      expect(runs.any((r) => r.italic && r.text.contains('italic')), isTrue);
    });

    test('parses heading', () {
      final elements = renderMarkdown('## Heading Two');
      expect(elements, hasLength(1));
      expect(elements[0].type, ElementType.heading);
      expect(elements[0].level, 2);
    });

    test('parses unordered list', () {
      final elements = renderMarkdown('- Item 1\n- Item 2');
      expect(elements, hasLength(2));
      expect(elements[0].type, ElementType.listItem);
      expect(elements[0].ordered, false);
      expect(elements[0].runs[0].text, contains('Item 1'));
    });

    test('parses ordered list', () {
      final elements = renderMarkdown('1. First\n2. Second');
      expect(elements, hasLength(2));
      expect(elements[0].type, ElementType.listItem);
      expect(elements[0].ordered, true);
      expect(elements[0].index, 1);
    });

    test('parses code span', () {
      final elements = renderMarkdown('Use `code` here.');
      expect(elements, hasLength(1));
      final runs = elements[0].runs;
      expect(runs.any((r) => r.code && r.text.contains('code')), isTrue);
    });

    test('parses thematic break', () {
      final elements = renderMarkdown('Text\n\n---\n\nMore text');
      expect(elements.any((e) => e.type == ElementType.thematicBreak), isTrue);
    });
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
flutter test test/core/markdown_parser_test.dart
```

Expected: FAIL — `markdown_parser.dart` does not exist.

- [ ] **Step 3: Implement Markdown parser**

```dart
// lib/core/markdown_parser.dart
import 'package:markdown/markdown.dart' as md;
import 'package:yaml/yaml.dart';
import '../models/letter.dart';

class FrontmatterResult {
  final String yaml;
  final String body;
  const FrontmatterResult({required this.yaml, required this.body});
}

class ParsedLetter {
  final Letter letter;
  final String body;
  const ParsedLetter({required this.letter, required this.body});
}

FrontmatterResult splitFrontmatter(String content) {
  final trimmed = content.trimLeft();
  if (!trimmed.startsWith('---')) {
    return FrontmatterResult(yaml: '', body: content);
  }
  final endIndex = trimmed.indexOf('---', 3);
  if (endIndex == -1) {
    return FrontmatterResult(yaml: '', body: content);
  }
  final yaml = trimmed.substring(3, endIndex).trim();
  final body = trimmed.substring(endIndex + 3);
  return FrontmatterResult(yaml: yaml, body: body);
}

ParsedLetter parseLetter(String content) {
  final fm = splitFrontmatter(content);
  final yamlMap = loadYaml(fm.yaml) as YamlMap;
  final map = _yamlToMap(yamlMap);
  final letter = Letter.fromMap(map);
  return ParsedLetter(letter: letter, body: fm.body);
}

Map<String, dynamic> _yamlToMap(YamlMap yamlMap) {
  final map = <String, dynamic>{};
  for (final entry in yamlMap.entries) {
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

// --- Intermediate element format ---

enum ElementType { paragraph, heading, listItem, table, thematicBreak }

class TextRun {
  final String text;
  final bool bold;
  final bool italic;
  final bool code;

  const TextRun({
    required this.text,
    this.bold = false,
    this.italic = false,
    this.code = false,
  });
}

class BodyElement {
  final ElementType type;
  final List<TextRun> runs;
  final int level; // for headings
  final bool ordered; // for list items
  final int index; // for ordered list items
  final List<String> headers; // for tables
  final List<List<String>> rows; // for tables

  const BodyElement({
    required this.type,
    this.runs = const [],
    this.level = 0,
    this.ordered = false,
    this.index = 0,
    this.headers = const [],
    this.rows = const [],
  });
}

List<BodyElement> renderMarkdown(String text) {
  final document = md.Document(
    extensionSet: md.ExtensionSet.gitHubFlavored,
  );
  final nodes = document.parse(text);
  final elements = <BodyElement>[];
  _convertNodes(nodes, elements);
  return elements;
}

void _convertNodes(List<md.Node> nodes, List<BodyElement> elements) {
  for (final node in nodes) {
    if (node is md.Element) {
      switch (node.tag) {
        case 'p':
          elements.add(BodyElement(
            type: ElementType.paragraph,
            runs: _extractRuns(node.children ?? []),
          ));
        case 'h1' || 'h2' || 'h3' || 'h4' || 'h5' || 'h6':
          elements.add(BodyElement(
            type: ElementType.heading,
            level: int.parse(node.tag.substring(1)),
            runs: _extractRuns(node.children ?? []),
          ));
        case 'ul':
          _convertListItems(node.children ?? [], elements, ordered: false);
        case 'ol':
          _convertListItems(node.children ?? [], elements, ordered: true);
        case 'hr':
          elements.add(const BodyElement(type: ElementType.thematicBreak));
        case 'table':
          _convertTable(node, elements);
        default:
          if (node.children != null) {
            _convertNodes(node.children!, elements);
          }
      }
    }
  }
}

void _convertListItems(
  List<md.Node> nodes,
  List<BodyElement> elements, {
  required bool ordered,
}) {
  var index = 1;
  for (final node in nodes) {
    if (node is md.Element && node.tag == 'li') {
      final runs = <TextRun>[];
      for (final child in node.children ?? <md.Node>[]) {
        if (child is md.Element && child.tag == 'p') {
          runs.addAll(_extractRuns(child.children ?? []));
        } else if (child is md.Text) {
          runs.add(TextRun(text: child.text));
        } else if (child is md.Element) {
          runs.addAll(_extractRuns([child]));
        }
      }
      elements.add(BodyElement(
        type: ElementType.listItem,
        runs: runs,
        ordered: ordered,
        index: index,
      ));
      index++;
    }
  }
}

void _convertTable(md.Element table, List<BodyElement> elements) {
  final headers = <String>[];
  final rows = <List<String>>[];

  for (final child in table.children ?? <md.Node>[]) {
    if (child is md.Element) {
      if (child.tag == 'thead') {
        for (final row in child.children ?? <md.Node>[]) {
          if (row is md.Element && row.tag == 'tr') {
            for (final cell in row.children ?? <md.Node>[]) {
              if (cell is md.Element) {
                headers.add(_extractText(cell.children ?? []));
              }
            }
          }
        }
      } else if (child.tag == 'tbody') {
        for (final row in child.children ?? <md.Node>[]) {
          if (row is md.Element && row.tag == 'tr') {
            final cells = <String>[];
            for (final cell in row.children ?? <md.Node>[]) {
              if (cell is md.Element) {
                cells.add(_extractText(cell.children ?? []));
              }
            }
            rows.add(cells);
          }
        }
      }
    }
  }

  elements.add(BodyElement(
    type: ElementType.table,
    headers: headers,
    rows: rows,
  ));
}

List<TextRun> _extractRuns(List<md.Node> nodes) {
  final runs = <TextRun>[];
  for (final node in nodes) {
    if (node is md.Text) {
      runs.add(TextRun(text: node.text));
    } else if (node is md.Element) {
      switch (node.tag) {
        case 'strong':
          for (final run in _extractRuns(node.children ?? [])) {
            runs.add(TextRun(text: run.text, bold: true, italic: run.italic, code: run.code));
          }
        case 'em':
          for (final run in _extractRuns(node.children ?? [])) {
            runs.add(TextRun(text: run.text, bold: run.bold, italic: true, code: run.code));
          }
        case 'code':
          runs.add(TextRun(text: _extractText(node.children ?? []), code: true));
        case 'br':
          runs.add(const TextRun(text: '\n'));
        default:
          runs.addAll(_extractRuns(node.children ?? []));
      }
    }
  }
  return runs;
}

String _extractText(List<md.Node> nodes) {
  final buffer = StringBuffer();
  for (final node in nodes) {
    if (node is md.Text) {
      buffer.write(node.text);
    } else if (node is md.Element) {
      buffer.write(_extractText(node.children ?? []));
    }
  }
  return buffer.toString();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
flutter test test/core/markdown_parser_test.dart
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/core/markdown_parser.dart test/core/markdown_parser_test.dart
git commit -m "feat: add Markdown parser with frontmatter splitting and AST conversion"
```

---

### Task 4: Template Engine

**Files:**
- Create: `lib/core/template_engine.dart`
- Create: `test/core/template_engine_test.dart`

- [ ] **Step 1: Write failing tests**

```dart
// test/core/template_engine_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:markdownoffice/core/template_engine.dart';
import 'package:markdownoffice/models/template.dart';

void main() {
  group('TemplateEngine', () {
    test('parses templates YAML string into map of LetterTemplates', () {
      const yaml = '''
din5008_b:
  description: DIN 5008 Form B
  page:
    width: 210
    height: 297
  margins:
    top: 20
    bottom: 20
    left: 25
    right: 20
  positions:
    header: 45
    return_address: 62.6
    address_field: 63.6
    body: 103.6
    fold_mark_1: 105
    hole_mark: 148.5
    fold_mark_2: 210
  typography:
    font_body: Source Serif 4
    font_ui: Source Sans 3
    font_mono: Source Code Pro
    font_size: 11
    line_height: 1.15
    color_gray: "#808080"
  footer:
    lines: 3
    separator: "\\u25AA"
  signature:
    max_height: 15
  qr_code:
    size: 18
''';

      final templates = TemplateEngine.parseTemplates(yaml);
      expect(templates, contains('din5008_b'));
      expect(templates['din5008_b']!.positions.body, 103.6);
      expect(templates['din5008_b']!.margins.left, 25.0);
    });

    test('builtinDin5008B returns valid template', () {
      final t = TemplateEngine.builtinDin5008B();
      expect(t.positions.header, 45.0);
      expect(t.positions.addressField, 63.6);
      expect(t.typography.fontSize, 11.0);
      expect(t.effectivePageWidth, 165.0);
    });

    test('builtinDin5008A returns valid template', () {
      final t = TemplateEngine.builtinDin5008A();
      expect(t.positions.header, 27.0);
      expect(t.positions.addressField, 45.0);
    });
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
flutter test test/core/template_engine_test.dart
```

Expected: FAIL — `template_engine.dart` does not exist.

- [ ] **Step 3: Implement TemplateEngine**

```dart
// lib/core/template_engine.dart
import 'package:yaml/yaml.dart';
import '../models/template.dart';

class TemplateEngine {
  static Map<String, LetterTemplate> parseTemplates(String yamlString) {
    final yamlMap = loadYaml(yamlString) as YamlMap;
    final templates = <String, LetterTemplate>{};
    for (final entry in yamlMap.entries) {
      final name = entry.key.toString();
      final data = _yamlToMap(entry.value as YamlMap);
      templates[name] = LetterTemplate.fromMap(data);
    }
    return templates;
  }

  static LetterTemplate builtinDin5008B() {
    return LetterTemplate.fromMap(const {
      'description': 'DIN 5008 Form B - Geschaeftsbrief',
      'page': {'width': 210.0, 'height': 297.0},
      'margins': {'top': 20.0, 'bottom': 20.0, 'left': 25.0, 'right': 20.0},
      'positions': {
        'header': 45.0,
        'return_address': 62.6,
        'address_field': 63.6,
        'body': 103.6,
        'fold_mark_1': 105.0,
        'hole_mark': 148.5,
        'fold_mark_2': 210.0,
      },
      'typography': {
        'font_body': 'Source Serif 4',
        'font_ui': 'Source Sans 3',
        'font_mono': 'Source Code Pro',
        'font_size': 11.0,
        'line_height': 1.15,
        'color_gray': '#808080',
      },
      'footer': {'lines': 3, 'separator': '\u25AA'},
      'signature': {'max_height': 15.0},
      'qr_code': {'size': 18.0},
    });
  }

  static LetterTemplate builtinDin5008A() {
    return LetterTemplate.fromMap(const {
      'description': 'DIN 5008 Form A - Geschaeftsbrief',
      'page': {'width': 210.0, 'height': 297.0},
      'margins': {'top': 20.0, 'bottom': 20.0, 'left': 25.0, 'right': 20.0},
      'positions': {
        'header': 27.0,
        'return_address': 44.0,
        'address_field': 45.0,
        'body': 85.0,
        'fold_mark_1': 87.0,
        'hole_mark': 148.5,
        'fold_mark_2': 192.0,
      },
      'typography': {
        'font_body': 'Source Serif 4',
        'font_ui': 'Source Sans 3',
        'font_mono': 'Source Code Pro',
        'font_size': 11.0,
        'line_height': 1.15,
        'color_gray': '#808080',
      },
      'footer': {'lines': 3, 'separator': '\u25AA'},
      'signature': {'max_height': 15.0},
      'qr_code': {'size': 18.0},
    });
  }

  static Map<String, dynamic> _yamlToMap(YamlMap yamlMap) {
    final map = <String, dynamic>{};
    for (final entry in yamlMap.entries) {
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
flutter test test/core/template_engine_test.dart
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/core/template_engine.dart test/core/template_engine_test.dart
git commit -m "feat: add template engine with YAML parsing and builtin DIN 5008 templates"
```

---

### Task 5: Config Loader with Platform-Aware Lookup

**Files:**
- Create: `lib/core/config_loader.dart`
- Create: `test/core/config_loader_test.dart`

- [ ] **Step 1: Write failing tests**

```dart
// test/core/config_loader_test.dart
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:markdownoffice/core/config_loader.dart';
import 'package:markdownoffice/models/config.dart';
import 'package:markdownoffice/models/profile.dart';
import 'package:markdownoffice/models/template.dart';

void main() {
  late Directory tempDir;

  setUp(() {
    tempDir = Directory.systemTemp.createTempSync('mdo_test_');
  });

  tearDown(() {
    tempDir.deleteSync(recursive: true);
  });

  group('ConfigLoader', () {
    test('loads config from path', () {
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
  name: Test User
  street: Teststr. 1
  zip: 12345
  city: Berlin
''');

      final loader = ConfigLoader(homePath: tempDir.path);
      final profiles = loader.loadProfiles();
      expect(profiles, contains('default'));
      expect(profiles['default']!.name, 'Test User');
      expect(profiles['default']!.zip, '12345');
    });

    test('loads profiles from cwd before home', () {
      // Write profiles to both locations
      final homeProfiles = File('${tempDir.path}/mdo_profiles.yaml');
      homeProfiles.writeAsStringSync('''
default:
  name: Home User
  street: S
  zip: 1
  city: C
''');

      final cwdDir = Directory('${tempDir.path}/cwd')..createSync();
      final cwdProfiles = File('${cwdDir.path}/mdo_profiles.yaml');
      cwdProfiles.writeAsStringSync('''
default:
  name: CWD User
  street: S
  zip: 1
  city: C
''');

      final loader = ConfigLoader(
        homePath: tempDir.path,
        cwdPath: cwdDir.path,
      );
      final profiles = loader.loadProfiles();
      expect(profiles['default']!.name, 'CWD User');
    });

    test('loads templates from home path', () {
      final templatesFile = File('${tempDir.path}/mdo_templates.yaml');
      templatesFile.writeAsStringSync('''
din5008_b:
  description: DIN 5008 Form B
  page:
    width: 210
    height: 297
  margins:
    top: 20
    bottom: 20
    left: 25
    right: 20
  positions:
    header: 45
    return_address: 62.6
    address_field: 63.6
    body: 103.6
    fold_mark_1: 105
    hole_mark: 148.5
    fold_mark_2: 210
  typography:
    font_body: Source Serif 4
    font_ui: Source Sans 3
    font_mono: Source Code Pro
    font_size: 11
    line_height: 1.15
    color_gray: "#808080"
  footer:
    lines: 3
    separator: "."
  signature:
    max_height: 15
  qr_code:
    size: 18
''');

      final loader = ConfigLoader(homePath: tempDir.path);
      final templates = loader.loadTemplates();
      expect(templates, contains('din5008_b'));
      expect(templates['din5008_b']!.positions.body, 103.6);
    });
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
flutter test test/core/config_loader_test.dart
```

Expected: FAIL — `config_loader.dart` does not exist.

- [ ] **Step 3: Implement ConfigLoader**

```dart
// lib/core/config_loader.dart
import 'dart:io';
import 'package:yaml/yaml.dart';
import '../models/config.dart';
import '../models/profile.dart';
import '../models/template.dart';
import 'template_engine.dart';

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
    if (!file.existsSync()) {
      return const AppConfig();
    }
    final yamlMap = loadYaml(file.readAsStringSync());
    if (yamlMap is! YamlMap) return const AppConfig();
    return AppConfig.fromMap(_yamlToMap(yamlMap));
  }

  Map<String, Profile> loadProfiles() {
    final content = _findFile('mdo_profiles.yaml');
    if (content == null) return {};
    final yamlMap = loadYaml(content);
    if (yamlMap is! YamlMap) return {};
    final profiles = <String, Profile>{};
    for (final entry in yamlMap.entries) {
      final name = entry.key.toString();
      if (entry.value is YamlMap) {
        profiles[name] = Profile.fromMap(_yamlToMap(entry.value as YamlMap));
      }
    }
    return profiles;
  }

  Map<String, LetterTemplate> loadTemplates() {
    final content = _findFile('mdo_templates.yaml');
    if (content == null) return {};
    return TemplateEngine.parseTemplates(content);
  }

  String? _findFile(String filename) {
    final searchPaths = <String>[
      if (cwdPath != null) cwdPath!,
      if (cloudPath != null) cloudPath!,
      homePath,
    ];
    for (final path in searchPaths) {
      final file = File('$path/$filename');
      if (file.existsSync()) {
        return file.readAsStringSync();
      }
    }
    return null;
  }

  static Map<String, dynamic> _yamlToMap(YamlMap yamlMap) {
    final map = <String, dynamic>{};
    for (final entry in yamlMap.entries) {
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
flutter test test/core/config_loader_test.dart
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/core/config_loader.dart test/core/config_loader_test.dart
git commit -m "feat: add config loader with platform-aware 3-tier file lookup"
```

---

### Task 6: PDF Renderer — Page Structure and Fold Marks

**Files:**
- Create: `lib/core/pdf_renderer.dart`
- Create: `test/core/pdf_renderer_test.dart`
- Create: `assets/fonts/` (directory for font files)

- [ ] **Step 1: Download and add font files**

Download Source Serif 4, Source Sans 3, and Source Code Pro from Google Fonts. Place the static `.ttf` files in `assets/fonts/`:

```
assets/fonts/SourceSerif4-Regular.ttf
assets/fonts/SourceSerif4-Bold.ttf
assets/fonts/SourceSans3-Regular.ttf
assets/fonts/SourceSans3-Bold.ttf
assets/fonts/SourceCodePro-Regular.ttf
```

Add to `pubspec.yaml` under `flutter:`:

```yaml
flutter:
  assets:
    - assets/fonts/
```

Note: The `pdf` package uses its own font loading (not Flutter's font system). Fonts are loaded as byte data and registered with the PDF document directly.

- [ ] **Step 2: Write failing test for basic PDF generation**

```dart
// test/core/pdf_renderer_test.dart
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:markdownoffice/core/pdf_renderer.dart';
import 'package:markdownoffice/models/letter.dart';
import 'package:markdownoffice/models/profile.dart';
import 'package:markdownoffice/models/template.dart';
import 'package:markdownoffice/core/template_engine.dart';
import 'package:markdownoffice/core/markdown_parser.dart';

void main() {
  group('PdfRenderer', () {
    late LetterTemplate template;
    late Profile profile;
    late Letter letter;
    late List<BodyElement> bodyElements;

    setUp(() {
      template = TemplateEngine.builtinDin5008B();
      profile = const Profile(
        name: 'Test User',
        street: 'Teststr. 1',
        zip: '12345',
        city: 'Berlin',
        email: 'test@example.com',
      );
      letter = Letter(
        profile: 'default',
        recipient: const Recipient(
          name: 'Max Mustermann',
          street: 'Beispielweg 5',
          zip: '10115',
          city: 'Berlin',
        ),
        subject: 'Testkuendigung',
        date: DateTime(2026, 4, 4),
      );
      bodyElements = renderMarkdown('Sehr geehrter Herr Mustermann,\n\nhiermit kuendige ich.');
    });

    test('generates valid PDF bytes', () async {
      final pdfBytes = await PdfRenderer.render(
        letter: letter,
        profile: profile,
        template: template,
        bodyElements: bodyElements,
      );
      expect(pdfBytes, isNotEmpty);
      // PDF files start with %PDF
      expect(String.fromCharCodes(pdfBytes.sublist(0, 4)), '%PDF');
    });

    test('generated PDF has at least one page', () async {
      final pdfBytes = await PdfRenderer.render(
        letter: letter,
        profile: profile,
        template: template,
        bodyElements: bodyElements,
      );
      // A valid PDF with content will be larger than 1KB
      expect(pdfBytes.length, greaterThan(1000));
    });
  });
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
flutter test test/core/pdf_renderer_test.dart
```

Expected: FAIL — `pdf_renderer.dart` does not exist.

- [ ] **Step 4: Implement PDF renderer**

```dart
// lib/core/pdf_renderer.dart
import 'dart:typed_data';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import '../models/letter.dart';
import '../models/profile.dart';
import '../models/template.dart';
import 'markdown_parser.dart';

class PdfRenderer {
  static Future<Uint8List> render({
    required Letter letter,
    required Profile profile,
    required LetterTemplate template,
    required List<BodyElement> bodyElements,
    Uint8List? signatureBytes,
  }) async {
    final pdf = pw.Document();
    final lineH = template.lineHeightMm * PdfPageFormat.mm;
    final pageFormat = PdfPageFormat(
      template.page.width * PdfPageFormat.mm,
      template.page.height * PdfPageFormat.mm,
      marginLeft: template.margins.left * PdfPageFormat.mm,
      marginRight: template.margins.right * PdfPageFormat.mm,
      marginTop: template.positions.body * PdfPageFormat.mm,
      marginBottom: template.margins.bottom * PdfPageFormat.mm,
    );

    final gray = PdfColor.fromHex(
      template.typography.colorGray.replaceFirst('#', ''),
    );

    // Font size constants in points
    final bodyFontSize = template.typography.fontSize;
    const returnAddressFontSize = 8.0;
    const footerFontSize = 8.0;
    const headerFontSize = 9.0;
    final separator = template.footer.separator;

    // Footer height calculation
    final footerLineH = footerFontSize * 0.3528 * 1.15 * PdfPageFormat.mm;
    final footerHeight = template.footer.lines * footerLineH + 1.5 * PdfPageFormat.mm;

    // German month names
    const months = [
      '', 'Januar', 'Februar', 'Maerz', 'April', 'Mai', 'Juni',
      'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
    ];
    final dateStr =
        '${letter.date.day.toString().padLeft(2, '0')}. ${months[letter.date.month]} ${letter.date.year}';

    // Contact line
    final contactParts = <String>[
      '${profile.name} $separator ${profile.street}, ${profile.zip} ${profile.city}',
    ];
    if (profile.phone != null) contactParts.add('Telefon ${profile.phone}');
    if (profile.email != null) contactParts.add('E-Mail ${profile.email}');
    final contactLine = contactParts.join(' $separator ');

    // Bank line
    String? bankLine;
    if (profile.bank != null) {
      final b = profile.bank!;
      final parts = <String>[];
      if (b.holder != profile.name) parts.add(b.holder);
      parts.addAll(['IBAN ${b.iban}', 'BIC ${b.bic}', b.bankName]);
      bankLine = parts.join(' $separator ');
    }

    // Return address line
    final returnAddr =
        '${profile.name} $separator ${profile.street} $separator ${profile.zip} ${profile.city}';

    // Sender block lines
    final senderLines = <String>[
      profile.name,
      profile.street,
      '${profile.zip} ${profile.city}',
    ];
    if (profile.phone != null) senderLines.add(profile.phone!);
    if (profile.email != null) senderLines.add(profile.email!);

    var isFirstPage = true;

    pdf.addPage(
      pw.MultiPage(
        pageFormat: pageFormat,
        maxPages: 100,
        header: (context) {
          if (isFirstPage) {
            isFirstPage = false;
            return _buildFirstPageHeader(
              template: template,
              lineH: lineH,
              gray: gray,
              senderLines: senderLines,
              returnAddr: returnAddr,
              letter: letter,
              dateStr: dateStr,
              bodyFontSize: bodyFontSize,
              returnAddressFontSize: returnAddressFontSize,
              separator: separator,
            );
          } else {
            // Follow-up page header
            final headerText =
                '${letter.recipient.name} $separator ${letter.subject} $separator Seite ${context.pageNumber}';
            return pw.Container(
              alignment: pw.Alignment.centerRight,
              padding: pw.EdgeInsets.only(
                bottom: 5 * PdfPageFormat.mm,
              ),
              child: pw.Text(
                headerText,
                style: pw.TextStyle(
                  fontSize: headerFontSize,
                  color: gray,
                ),
              ),
            );
          }
        },
        footer: (context) {
          return _buildFooter(
            template: template,
            gray: gray,
            footerFontSize: footerFontSize,
            contactLine: contactLine,
            bankLine: bankLine,
            separator: separator,
            pageNumber: context.pageNumber,
            totalPages: context.pagesCount,
          );
        },
        build: (context) {
          final widgets = <pw.Widget>[];

          // Body elements
          for (final element in bodyElements) {
            switch (element.type) {
              case ElementType.paragraph:
                widgets.add(_buildParagraph(element, bodyFontSize));
                widgets.add(pw.SizedBox(height: lineH));
              case ElementType.heading:
                widgets.add(pw.SizedBox(height: lineH));
                widgets.add(_buildHeading(element, bodyFontSize));
              case ElementType.listItem:
                widgets.add(_buildListItem(element, bodyFontSize, template, separator));
              case ElementType.thematicBreak:
                widgets.add(pw.Divider(color: gray));
              case ElementType.table:
                widgets.add(_buildTable(element, bodyFontSize));
                widgets.add(pw.SizedBox(height: lineH));
            }
          }

          // Closing
          widgets.add(pw.SizedBox(height: lineH));
          widgets.add(pw.Text(
            letter.closing,
            style: pw.TextStyle(fontSize: bodyFontSize),
          ));

          // Signature space
          if (letter.sign && signatureBytes != null) {
            final sigImage = pw.MemoryImage(signatureBytes!);
            widgets.add(pw.Image(
              sigImage,
              height: profile.signatureHeight * PdfPageFormat.mm,
              fit: pw.BoxFit.contain,
              alignment: pw.Alignment.centerLeft,
            ));
          } else {
            widgets.add(pw.SizedBox(height: 3 * lineH));
          }

          // Sender name
          widgets.add(pw.Text(
            profile.name,
            style: pw.TextStyle(fontSize: bodyFontSize),
          ));

          // Attachments
          if (letter.attachments.isNotEmpty) {
            widgets.add(pw.SizedBox(height: lineH));
            widgets.add(pw.Text(
              'Anlagen:',
              style: pw.TextStyle(
                fontSize: bodyFontSize,
                fontWeight: pw.FontWeight.bold,
              ),
            ));
            for (final att in letter.attachments) {
              widgets.add(pw.Padding(
                padding: const pw.EdgeInsets.only(left: 5 * PdfPageFormat.mm),
                child: pw.Text(
                  '$separator $att',
                  style: pw.TextStyle(fontSize: bodyFontSize),
                ),
              ));
            }
          }

          return widgets;
        },
      ),
    );

    return pdf.save();
  }

  static pw.Widget _buildFirstPageHeader({
    required LetterTemplate template,
    required double lineH,
    required PdfColor gray,
    required List<String> senderLines,
    required String returnAddr,
    required Letter letter,
    required String dateStr,
    required double bodyFontSize,
    required double returnAddressFontSize,
    required String separator,
  }) {
    // This header positions elements absolutely on the first page
    // using a Stack relative to the page top
    final widgets = <pw.Widget>[];

    // Fold marks
    widgets.add(pw.Positioned(
      left: -template.margins.left * PdfPageFormat.mm + 5 * PdfPageFormat.mm,
      top: (template.positions.foldMark1 - template.positions.body) * PdfPageFormat.mm,
      child: pw.Container(
        width: 4 * PdfPageFormat.mm,
        height: 0.25 * PdfPageFormat.mm,
        color: gray,
      ),
    ));
    widgets.add(pw.Positioned(
      left: -template.margins.left * PdfPageFormat.mm + 5 * PdfPageFormat.mm,
      top: (template.positions.holeMark - template.positions.body) * PdfPageFormat.mm,
      child: pw.Container(
        width: 6 * PdfPageFormat.mm,
        height: 0.25 * PdfPageFormat.mm,
        color: gray,
      ),
    ));
    widgets.add(pw.Positioned(
      left: -template.margins.left * PdfPageFormat.mm + 5 * PdfPageFormat.mm,
      top: (template.positions.foldMark2 - template.positions.body) * PdfPageFormat.mm,
      child: pw.Container(
        width: 4 * PdfPageFormat.mm,
        height: 0.25 * PdfPageFormat.mm,
        color: gray,
      ),
    ));

    // Sender block (right-aligned, 55mm wide)
    final senderBlockWidth = 55 * PdfPageFormat.mm;
    final senderX = (template.page.width - template.margins.right - 55 - template.margins.left) * PdfPageFormat.mm;
    final senderY = (template.positions.header - template.positions.body) * PdfPageFormat.mm;
    widgets.add(pw.Positioned(
      left: senderX,
      top: senderY,
      child: pw.SizedBox(
        width: senderBlockWidth,
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: senderLines
              .map((line) => pw.Text(
                    line,
                    style: pw.TextStyle(fontSize: bodyFontSize),
                  ))
              .toList(),
        ),
      ),
    ));

    // Return address line
    final returnY = (template.positions.returnAddress - template.positions.body) * PdfPageFormat.mm;
    widgets.add(pw.Positioned(
      left: 0,
      top: returnY,
      child: pw.Text(
        returnAddr,
        style: pw.TextStyle(
          fontSize: returnAddressFontSize,
          color: gray,
          decoration: pw.TextDecoration.underline,
        ),
      ),
    ));

    // Recipient
    final recipientY = (template.positions.addressField - template.positions.body + 1) * PdfPageFormat.mm;
    final recipientLines = <String>[
      letter.recipient.name,
      if (letter.recipient.extra != null) letter.recipient.extra!,
      letter.recipient.street,
      '${letter.recipient.zip} ${letter.recipient.city}',
    ];
    widgets.add(pw.Positioned(
      left: 0,
      top: recipientY,
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: recipientLines
            .map((line) => pw.Text(
                  line,
                  style: pw.TextStyle(fontSize: bodyFontSize),
                ))
            .toList(),
      ),
    ));

    // Date line (right-aligned)
    widgets.add(pw.Positioned(
      right: 0,
      top: 0,
      child: pw.Text(
        dateStr,
        style: pw.TextStyle(fontSize: bodyFontSize),
      ),
    ));

    // Subject (bold, after date + blank line)
    widgets.add(pw.Positioned(
      left: 0,
      top: 2 * lineH,
      child: pw.Text(
        letter.subject,
        style: pw.TextStyle(
          fontSize: bodyFontSize,
          fontWeight: pw.FontWeight.bold,
        ),
      ),
    ));

    return pw.SizedBox(
      height: 3 * lineH + bodyFontSize * 0.3528 * PdfPageFormat.mm,
      child: pw.Stack(children: widgets),
    );
  }

  static pw.Widget _buildFooter({
    required LetterTemplate template,
    required PdfColor gray,
    required double footerFontSize,
    required String contactLine,
    required String? bankLine,
    required String separator,
    required int pageNumber,
    required int totalPages,
  }) {
    final footerStyle = pw.TextStyle(
      fontSize: footerFontSize,
      color: gray,
    );
    final pageStr = 'Seite $pageNumber von $totalPages';

    final lines = <pw.Widget>[];

    // Separator line
    lines.add(pw.Divider(color: gray, thickness: 0.5));
    lines.add(pw.SizedBox(height: 1 * PdfPageFormat.mm));

    if (bankLine != null) {
      lines.add(pw.Center(child: pw.Text(contactLine, style: footerStyle)));
      lines.add(pw.Center(child: pw.Text(bankLine, style: footerStyle)));
    } else {
      lines.add(pw.Center(child: pw.Text(contactLine, style: footerStyle)));
    }
    lines.add(pw.Center(child: pw.Text(pageStr, style: footerStyle)));

    return pw.Column(children: lines);
  }

  static pw.Widget _buildParagraph(BodyElement element, double fontSize) {
    return pw.RichText(
      text: pw.TextSpan(
        children: element.runs.map((run) {
          return pw.TextSpan(
            text: run.text,
            style: pw.TextStyle(
              fontSize: fontSize,
              fontWeight: run.bold ? pw.FontWeight.bold : pw.FontWeight.normal,
              fontStyle: run.italic ? pw.FontStyle.italic : pw.FontStyle.normal,
              font: run.code ? pw.Font.courier() : null,
              fontSize: run.code ? fontSize * 0.9 : fontSize,
            ),
          );
        }).toList(),
      ),
    );
  }

  static pw.Widget _buildHeading(BodyElement element, double fontSize) {
    return pw.Text(
      element.runs.map((r) => r.text).join(),
      style: pw.TextStyle(
        fontSize: fontSize,
        fontWeight: pw.FontWeight.bold,
      ),
    );
  }

  static pw.Widget _buildListItem(
    BodyElement element,
    double fontSize,
    LetterTemplate template,
    String separator,
  ) {
    final prefix = element.ordered ? '${element.index}. ' : '$separator ';
    return pw.Padding(
      padding: const pw.EdgeInsets.only(left: 5 * PdfPageFormat.mm),
      child: pw.RichText(
        text: pw.TextSpan(
          children: [
            pw.TextSpan(
              text: prefix,
              style: pw.TextStyle(fontSize: fontSize),
            ),
            ...element.runs.map((run) {
              return pw.TextSpan(
                text: run.text,
                style: pw.TextStyle(
                  fontSize: fontSize,
                  fontWeight: run.bold ? pw.FontWeight.bold : pw.FontWeight.normal,
                  fontStyle: run.italic ? pw.FontStyle.italic : pw.FontStyle.normal,
                ),
              );
            }),
          ],
        ),
      ),
    );
  }

  static pw.Widget _buildTable(BodyElement element, double fontSize) {
    final allRows = [element.headers, ...element.rows];
    return pw.TableHelper.fromTextArray(
      data: allRows,
      headerCount: 1,
      cellStyle: pw.TextStyle(fontSize: fontSize * 0.9),
      headerStyle: pw.TextStyle(fontSize: fontSize * 0.9, fontWeight: pw.FontWeight.bold),
      cellAlignment: pw.Alignment.centerLeft,
    );
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
flutter test test/core/pdf_renderer_test.dart
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/core/pdf_renderer.dart test/core/pdf_renderer_test.dart assets/fonts/
git commit -m "feat: add PDF renderer with DIN 5008 layout, fold marks, footer, and multi-page support"
```

---

### Task 7: Riverpod Providers

**Files:**
- Create: `lib/providers/config_provider.dart`
- Create: `lib/providers/profile_provider.dart`
- Create: `lib/providers/template_provider.dart`
- Create: `lib/providers/letter_provider.dart`

- [ ] **Step 1: Implement config provider**

```dart
// lib/providers/config_provider.dart
import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import '../core/config_loader.dart';
import '../models/config.dart';

final configLoaderProvider = Provider<ConfigLoader>((ref) {
  throw UnimplementedError('Override in main with platform-specific paths');
});

final configProvider = FutureProvider<AppConfig>((ref) async {
  final loader = ref.read(configLoaderProvider);
  return loader.loadConfig();
});
```

- [ ] **Step 2: Implement profile provider**

```dart
// lib/providers/profile_provider.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/profile.dart';
import 'config_provider.dart';

final profilesProvider = FutureProvider<Map<String, Profile>>((ref) async {
  final loader = ref.read(configLoaderProvider);
  return loader.loadProfiles();
});

final selectedProfileProvider = StateProvider<String>((ref) => 'default');

final activeProfileProvider = Provider<Profile?>((ref) {
  final profiles = ref.watch(profilesProvider).valueOrNull ?? {};
  final selected = ref.watch(selectedProfileProvider);
  return profiles[selected] ?? profiles['default'];
});
```

- [ ] **Step 3: Implement template provider**

```dart
// lib/providers/template_provider.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/template_engine.dart';
import '../models/template.dart';
import 'config_provider.dart';

final templatesProvider = FutureProvider<Map<String, LetterTemplate>>((ref) async {
  final loader = ref.read(configLoaderProvider);
  final templates = loader.loadTemplates();
  if (templates.isEmpty) {
    // Fallback to builtin templates
    return {
      'din5008_b': TemplateEngine.builtinDin5008B(),
      'din5008_a': TemplateEngine.builtinDin5008A(),
    };
  }
  return templates;
});

final activeTemplateProvider = Provider<LetterTemplate>((ref) {
  final templates = ref.watch(templatesProvider).valueOrNull ?? {};
  // Template name comes from active profile
  final profiles = ref.watch(configLoaderProvider).loadProfiles();
  final profileName = 'default';
  final profile = profiles[profileName];
  final templateName = profile?.template ?? 'din5008_b';
  return templates[templateName] ?? TemplateEngine.builtinDin5008B();
});
```

- [ ] **Step 4: Implement letter provider**

```dart
// lib/providers/letter_provider.dart
import 'dart:typed_data';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/markdown_parser.dart';
import '../core/pdf_renderer.dart';
import '../models/letter.dart';
import '../models/profile.dart';
import '../models/template.dart';
import 'profile_provider.dart';
import 'template_provider.dart';

class LetterState {
  final Letter? letter;
  final String body;
  final List<BodyElement> bodyElements;

  const LetterState({
    this.letter,
    this.body = '',
    this.bodyElements = const [],
  });

  LetterState copyWith({
    Letter? letter,
    String? body,
    List<BodyElement>? bodyElements,
  }) {
    return LetterState(
      letter: letter ?? this.letter,
      body: body ?? this.body,
      bodyElements: bodyElements ?? this.bodyElements,
    );
  }
}

class LetterNotifier extends StateNotifier<LetterState> {
  LetterNotifier() : super(const LetterState());

  void loadFromMarkdown(String content) {
    try {
      final parsed = parseLetter(content);
      final elements = renderMarkdown(parsed.body);
      state = LetterState(
        letter: parsed.letter,
        body: parsed.body,
        bodyElements: elements,
      );
    } catch (_) {
      // If frontmatter parsing fails, treat as body-only
      final elements = renderMarkdown(content);
      state = LetterState(
        body: content,
        bodyElements: elements,
      );
    }
  }

  void updateBody(String body) {
    final elements = renderMarkdown(body);
    state = state.copyWith(body: body, bodyElements: elements);
  }

  void updateLetter(Letter letter) {
    state = state.copyWith(letter: letter);
  }
}

final letterProvider = StateNotifierProvider<LetterNotifier, LetterState>((ref) {
  return LetterNotifier();
});

final pdfBytesProvider = FutureProvider<Uint8List?>((ref) async {
  final letterState = ref.watch(letterProvider);
  final profile = ref.watch(activeProfileProvider);
  final template = ref.watch(activeTemplateProvider);
  if (letterState.letter == null || profile == null) return null;
  return PdfRenderer.render(
    letter: letterState.letter!,
    profile: profile,
    template: template,
    bodyElements: letterState.bodyElements,
  );
});
```

- [ ] **Step 5: Commit**

```bash
git add lib/providers/
git commit -m "feat: add Riverpod providers for config, profiles, templates, and letter state"
```

---

### Task 8: Editor Screen — Formular, Textfeld, PDF-Vorschau

**Files:**
- Create: `lib/features/editor/editor_screen.dart`
- Create: `lib/features/editor/letter_form.dart`
- Create: `lib/features/editor/pdf_preview.dart`

- [ ] **Step 1: Implement LetterForm widget**

```dart
// lib/features/editor/letter_form.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/letter.dart';
import '../../providers/letter_provider.dart';

class LetterForm extends ConsumerStatefulWidget {
  const LetterForm({super.key});

  @override
  ConsumerState<LetterForm> createState() => _LetterFormState();
}

class _LetterFormState extends ConsumerState<LetterForm> {
  final _recipientNameController = TextEditingController();
  final _recipientExtraController = TextEditingController();
  final _recipientStreetController = TextEditingController();
  final _recipientZipController = TextEditingController();
  final _recipientCityController = TextEditingController();
  final _subjectController = TextEditingController();
  final _closingController = TextEditingController(text: 'Mit freundlichen Gruessen');
  final _bodyController = TextEditingController();
  DateTime _date = DateTime.now();
  bool _sign = false;
  final _attachmentControllers = <TextEditingController>[];

  @override
  void dispose() {
    _recipientNameController.dispose();
    _recipientExtraController.dispose();
    _recipientStreetController.dispose();
    _recipientZipController.dispose();
    _recipientCityController.dispose();
    _subjectController.dispose();
    _closingController.dispose();
    _bodyController.dispose();
    for (final c in _attachmentControllers) {
      c.dispose();
    }
    super.dispose();
  }

  void _updateLetter() {
    final letter = Letter(
      profile: ref.read(letterProvider).letter?.profile ?? 'default',
      recipient: Recipient(
        name: _recipientNameController.text,
        extra: _recipientExtraController.text.isEmpty ? null : _recipientExtraController.text,
        street: _recipientStreetController.text,
        zip: _recipientZipController.text,
        city: _recipientCityController.text,
      ),
      subject: _subjectController.text,
      date: _date,
      closing: _closingController.text,
      sign: _sign,
      attachments: _attachmentControllers
          .map((c) => c.text)
          .where((t) => t.isNotEmpty)
          .toList(),
    );
    ref.read(letterProvider.notifier).updateLetter(letter);
  }

  void _updateBody() {
    ref.read(letterProvider.notifier).updateBody(_bodyController.text);
  }

  void _loadLetterIntoForm(Letter letter, String body) {
    _recipientNameController.text = letter.recipient.name;
    _recipientExtraController.text = letter.recipient.extra ?? '';
    _recipientStreetController.text = letter.recipient.street;
    _recipientZipController.text = letter.recipient.zip;
    _recipientCityController.text = letter.recipient.city;
    _subjectController.text = letter.subject;
    _closingController.text = letter.closing;
    _bodyController.text = body;
    _date = letter.date;
    _sign = letter.sign;
    _attachmentControllers.clear();
    for (final att in letter.attachments) {
      _attachmentControllers.add(TextEditingController(text: att));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Empfaenger', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          TextField(
            controller: _recipientNameController,
            decoration: const InputDecoration(labelText: 'Name', border: OutlineInputBorder()),
            onChanged: (_) => _updateLetter(),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _recipientExtraController,
            decoration: const InputDecoration(labelText: 'Zusatz (optional)', border: OutlineInputBorder()),
            onChanged: (_) => _updateLetter(),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _recipientStreetController,
            decoration: const InputDecoration(labelText: 'Strasse', border: OutlineInputBorder()),
            onChanged: (_) => _updateLetter(),
          ),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
              flex: 2,
              child: TextField(
                controller: _recipientZipController,
                decoration: const InputDecoration(labelText: 'PLZ', border: OutlineInputBorder()),
                onChanged: (_) => _updateLetter(),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              flex: 5,
              child: TextField(
                controller: _recipientCityController,
                decoration: const InputDecoration(labelText: 'Ort', border: OutlineInputBorder()),
                onChanged: (_) => _updateLetter(),
              ),
            ),
          ]),
          const SizedBox(height: 16),
          TextField(
            controller: _subjectController,
            decoration: const InputDecoration(labelText: 'Betreff', border: OutlineInputBorder()),
            onChanged: (_) => _updateLetter(),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _closingController,
            decoration: const InputDecoration(labelText: 'Schlussformel', border: OutlineInputBorder()),
            onChanged: (_) => _updateLetter(),
          ),
          const SizedBox(height: 16),
          Text('Brieftext', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          TextField(
            controller: _bodyController,
            maxLines: 12,
            decoration: const InputDecoration(
              hintText: 'Markdown-Text eingeben...',
              border: OutlineInputBorder(),
            ),
            onChanged: (_) => _updateBody(),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 2: Implement PdfPreview widget**

```dart
// lib/features/editor/pdf_preview.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';
import '../../providers/letter_provider.dart';

class PdfPreview extends ConsumerWidget {
  const PdfPreview({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pdfAsync = ref.watch(pdfBytesProvider);

    return pdfAsync.when(
      data: (bytes) {
        if (bytes == null) {
          return const Center(
            child: Text('Bitte alle Pflichtfelder ausfuellen.'),
          );
        }
        return PdfPreview(
          build: (_) async => bytes,
          canChangePageFormat: false,
          canChangeOrientation: false,
          canDebug: false,
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => Center(child: Text('Fehler: $err')),
    );
  }
}
```

Note: The `PdfPreview` widget name conflicts with the `printing` package's `PdfPreview`. Rename to `LetterPdfPreview`:

```dart
// lib/features/editor/pdf_preview.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart' as printing;
import '../../providers/letter_provider.dart';

class LetterPdfPreview extends ConsumerWidget {
  const LetterPdfPreview({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pdfAsync = ref.watch(pdfBytesProvider);

    return pdfAsync.when(
      data: (bytes) {
        if (bytes == null) {
          return const Center(
            child: Text('Bitte alle Pflichtfelder ausfuellen.'),
          );
        }
        return printing.PdfPreview(
          build: (_) async => bytes,
          canChangePageFormat: false,
          canChangeOrientation: false,
          canDebug: false,
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => Center(child: Text('Fehler: $err')),
    );
  }
}
```

- [ ] **Step 3: Implement EditorScreen with responsive split-view**

```dart
// lib/features/editor/editor_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:file_picker/file_picker.dart';
import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb;
import '../../providers/letter_provider.dart';
import '../../providers/profile_provider.dart';
import 'letter_form.dart';
import 'pdf_preview.dart';

class EditorScreen extends ConsumerWidget {
  const EditorScreen({super.key});

  Future<void> _openFile(WidgetRef ref) async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['md'],
    );
    if (result != null && result.files.single.path != null) {
      final content = File(result.files.single.path!).readAsStringSync();
      ref.read(letterProvider.notifier).loadFromMarkdown(content);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final width = MediaQuery.of(context).size.width;
    final isWide = width > 800;

    return Scaffold(
      appBar: AppBar(
        title: const Text('MarkdownOffice'),
        actions: [
          IconButton(
            icon: const Icon(Icons.folder_open),
            tooltip: 'Datei oeffnen',
            onPressed: () => _openFile(ref),
          ),
          const _ProfileDropdown(),
        ],
      ),
      body: isWide
          ? Row(
              children: [
                const Expanded(child: LetterForm()),
                const VerticalDivider(width: 1),
                const Expanded(child: LetterPdfPreview()),
              ],
            )
          : const _TabView(),
    );
  }
}

class _ProfileDropdown extends ConsumerWidget {
  const _ProfileDropdown();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profilesAsync = ref.watch(profilesProvider);
    final selected = ref.watch(selectedProfileProvider);

    return profilesAsync.when(
      data: (profiles) {
        if (profiles.isEmpty) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: DropdownButton<String>(
            value: profiles.containsKey(selected) ? selected : profiles.keys.first,
            items: profiles.keys
                .map((name) => DropdownMenuItem(value: name, child: Text(name)))
                .toList(),
            onChanged: (value) {
              if (value != null) {
                ref.read(selectedProfileProvider.notifier).state = value;
              }
            },
          ),
        );
      },
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
    );
  }
}

class _TabView extends StatelessWidget {
  const _TabView();

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Column(
        children: [
          const TabBar(tabs: [
            Tab(text: 'Bearbeiten'),
            Tab(text: 'Vorschau'),
          ]),
          Expanded(
            child: TabBarView(children: [
              const LetterForm(),
              const LetterPdfPreview(),
            ]),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 4: Wire EditorScreen into main.dart**

Update `lib/main.dart`:

```dart
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'core/config_loader.dart';
import 'features/editor/editor_screen.dart';
import 'providers/config_provider.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  late final ConfigLoader loader;
  if (kIsWeb) {
    // Web: no file system, use empty loader
    loader = ConfigLoader(homePath: '');
  } else {
    final homeDir = Platform.environment['HOME'] ?? '.';
    final configPath = '$homeDir/.config/markdownoffice';
    final cwdPath = Directory.current.path;

    // Load config to get cloud path
    final tempLoader = ConfigLoader(homePath: configPath);
    final config = tempLoader.loadConfig();

    loader = ConfigLoader(
      homePath: configPath,
      cwdPath: cwdPath,
      cloudPath: config.cloudPath,
    );
  }

  runApp(
    ProviderScope(
      overrides: [
        configLoaderProvider.overrideWithValue(loader),
      ],
      child: const MarkdownOfficeApp(),
    ),
  );
}

class MarkdownOfficeApp extends StatelessWidget {
  const MarkdownOfficeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MarkdownOffice',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.blueGrey),
        useMaterial3: true,
      ),
      home: const EditorScreen(),
    );
  }
}
```

- [ ] **Step 5: Run the app to verify it builds and shows the editor**

```bash
flutter run -d macos
```

Expected: App launches, shows AppBar with "MarkdownOffice", form on left, preview on right.

- [ ] **Step 6: Commit**

```bash
git add lib/features/editor/ lib/main.dart
git commit -m "feat: add editor screen with responsive split-view, letter form, and PDF preview"
```

---

### Task 9: Profile Management Screen

**Files:**
- Create: `lib/features/profiles/profiles_screen.dart`
- Create: `lib/features/profiles/profile_editor.dart`

- [ ] **Step 1: Implement ProfilesScreen**

```dart
// lib/features/profiles/profiles_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/profile_provider.dart';
import 'profile_editor.dart';

class ProfilesScreen extends ConsumerWidget {
  const ProfilesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profilesAsync = ref.watch(profilesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => const ProfileEditor(profileName: null),
            ),
          );
        },
        child: const Icon(Icons.add),
      ),
      body: profilesAsync.when(
        data: (profiles) {
          if (profiles.isEmpty) {
            return const Center(child: Text('Keine Profile vorhanden.'));
          }
          return ListView.builder(
            itemCount: profiles.length,
            itemBuilder: (context, index) {
              final name = profiles.keys.elementAt(index);
              final profile = profiles[name]!;
              return ListTile(
                title: Text(name),
                subtitle: Text('${profile.name}, ${profile.city}'),
                trailing: Text(profile.template),
                onTap: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => ProfileEditor(profileName: name),
                    ),
                  );
                },
              );
            },
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('Fehler: $err')),
      ),
    );
  }
}
```

- [ ] **Step 2: Implement ProfileEditor**

```dart
// lib/features/profiles/profile_editor.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/profile.dart';
import '../../providers/profile_provider.dart';

class ProfileEditor extends ConsumerStatefulWidget {
  final String? profileName;

  const ProfileEditor({super.key, required this.profileName});

  @override
  ConsumerState<ProfileEditor> createState() => _ProfileEditorState();
}

class _ProfileEditorState extends ConsumerState<ProfileEditor> {
  final _nameController = TextEditingController();
  final _streetController = TextEditingController();
  final _zipController = TextEditingController();
  final _cityController = TextEditingController();
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  final _templateController = TextEditingController(text: 'din5008_b');

  @override
  void initState() {
    super.initState();
    if (widget.profileName != null) {
      final profiles = ref.read(profilesProvider).valueOrNull ?? {};
      final profile = profiles[widget.profileName];
      if (profile != null) {
        _nameController.text = profile.name;
        _streetController.text = profile.street;
        _zipController.text = profile.zip;
        _cityController.text = profile.city;
        _phoneController.text = profile.phone ?? '';
        _emailController.text = profile.email ?? '';
        _templateController.text = profile.template;
      }
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _streetController.dispose();
    _zipController.dispose();
    _cityController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    _templateController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isNew = widget.profileName == null;

    return Scaffold(
      appBar: AppBar(
        title: Text(isNew ? 'Neues Profil' : 'Profil bearbeiten'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            TextField(
              controller: _nameController,
              decoration: const InputDecoration(labelText: 'Name *', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _streetController,
              decoration: const InputDecoration(labelText: 'Strasse *', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(
                flex: 2,
                child: TextField(
                  controller: _zipController,
                  decoration: const InputDecoration(labelText: 'PLZ *', border: OutlineInputBorder()),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 5,
                child: TextField(
                  controller: _cityController,
                  decoration: const InputDecoration(labelText: 'Ort *', border: OutlineInputBorder()),
                ),
              ),
            ]),
            const SizedBox(height: 8),
            TextField(
              controller: _phoneController,
              decoration: const InputDecoration(labelText: 'Telefon', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _emailController,
              decoration: const InputDecoration(labelText: 'E-Mail', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _templateController,
              decoration: const InputDecoration(labelText: 'Template', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () {
                // TODO: Save profile to YAML file
                Navigator.pop(context);
              },
              child: const Text('Speichern'),
            ),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 3: Add navigation to ProfilesScreen from EditorScreen**

Add a drawer to `EditorScreen` in `lib/features/editor/editor_screen.dart`. In the `Scaffold`, add:

```dart
drawer: Drawer(
  child: ListView(
    children: [
      const DrawerHeader(child: Text('MarkdownOffice', style: TextStyle(fontSize: 24))),
      ListTile(
        leading: const Icon(Icons.edit),
        title: const Text('Dokument'),
        onTap: () => Navigator.pop(context),
      ),
      ListTile(
        leading: const Icon(Icons.person),
        title: const Text('Profile'),
        onTap: () {
          Navigator.pop(context);
          Navigator.push(context, MaterialPageRoute(builder: (_) => const ProfilesScreen()));
        },
      ),
    ],
  ),
),
```

Add the import at the top of `editor_screen.dart`:

```dart
import '../profiles/profiles_screen.dart';
```

- [ ] **Step 4: Run the app and verify navigation works**

```bash
flutter run -d macos
```

Expected: Drawer opens, navigates to Profile list, profile editor opens.

- [ ] **Step 5: Commit**

```bash
git add lib/features/profiles/ lib/features/editor/editor_screen.dart
git commit -m "feat: add profile management screen with list and editor"
```

---

### Task 10: Template Management Screen

**Files:**
- Create: `lib/features/templates/templates_screen.dart`

- [ ] **Step 1: Implement TemplatesScreen**

```dart
// lib/features/templates/templates_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/template_provider.dart';

class TemplatesScreen extends ConsumerWidget {
  const TemplatesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final templatesAsync = ref.watch(templatesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Templates'),
        actions: [
          IconButton(
            icon: const Icon(Icons.restore),
            tooltip: 'Werkseinstellungen',
            onPressed: () {
              // TODO: Reset templates from repo
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Templates zurueckgesetzt.')),
              );
            },
          ),
        ],
      ),
      body: templatesAsync.when(
        data: (templates) {
          if (templates.isEmpty) {
            return const Center(child: Text('Keine Templates vorhanden.'));
          }
          return ListView.builder(
            itemCount: templates.length,
            itemBuilder: (context, index) {
              final name = templates.keys.elementAt(index);
              final template = templates[name]!;
              return ListTile(
                title: Text(name),
                subtitle: Text(template.description),
                trailing: Text('${template.page.width.toInt()}x${template.page.height.toInt()}mm'),
                onTap: () {
                  showDialog(
                    context: context,
                    builder: (_) => AlertDialog(
                      title: Text(name),
                      content: SingleChildScrollView(
                        child: Text(
                          'Beschreibung: ${template.description}\n'
                          'Seite: ${template.page.width}x${template.page.height}mm\n'
                          'Raender: L${template.margins.left} R${template.margins.right} '
                          'T${template.margins.top} B${template.margins.bottom}\n'
                          'Textkoerper ab: ${template.positions.body}mm\n'
                          'Schrift: ${template.typography.fontBody}, ${template.typography.fontSize}pt\n'
                          'Zeilenhoehe: ${template.lineHeightMm.toStringAsFixed(2)}mm',
                        ),
                      ),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text('Schliessen'),
                        ),
                      ],
                    ),
                  );
                },
              );
            },
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('Fehler: $err')),
      ),
    );
  }
}
```

- [ ] **Step 2: Add Templates to drawer navigation**

In `lib/features/editor/editor_screen.dart`, add to the drawer:

```dart
ListTile(
  leading: const Icon(Icons.description),
  title: const Text('Templates'),
  onTap: () {
    Navigator.pop(context);
    Navigator.push(context, MaterialPageRoute(builder: (_) => const TemplatesScreen()));
  },
),
```

Add the import:

```dart
import '../templates/templates_screen.dart';
```

- [ ] **Step 3: Commit**

```bash
git add lib/features/templates/ lib/features/editor/editor_screen.dart
git commit -m "feat: add template management screen with list and detail view"
```

---

### Task 11: Export — PDF Save, Share, Print

**Files:**
- Modify: `lib/features/editor/editor_screen.dart`

- [ ] **Step 1: Add export actions to AppBar**

In `editor_screen.dart`, add export buttons to the `AppBar.actions`:

```dart
IconButton(
  icon: const Icon(Icons.save),
  tooltip: 'PDF speichern',
  onPressed: () => _savePdf(ref, context),
),
IconButton(
  icon: const Icon(Icons.share),
  tooltip: 'Teilen',
  onPressed: () => _sharePdf(ref, context),
),
IconButton(
  icon: const Icon(Icons.print),
  tooltip: 'Drucken',
  onPressed: () => _printPdf(ref, context),
),
```

- [ ] **Step 2: Implement export methods**

Add these methods to `EditorScreen`:

```dart
Future<void> _savePdf(WidgetRef ref, BuildContext context) async {
  final bytes = await ref.read(pdfBytesProvider.future);
  if (bytes == null) return;
  final outputPath = await FilePicker.platform.saveFile(
    dialogTitle: 'PDF speichern',
    fileName: 'brief.pdf',
    type: FileType.custom,
    allowedExtensions: ['pdf'],
  );
  if (outputPath != null) {
    File(outputPath).writeAsBytesSync(bytes);
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Gespeichert: $outputPath')),
      );
    }
  }
}

Future<void> _sharePdf(WidgetRef ref, BuildContext context) async {
  final bytes = await ref.read(pdfBytesProvider.future);
  if (bytes == null) return;
  await Printing.sharePdf(bytes: bytes, filename: 'brief.pdf');
}

Future<void> _printPdf(WidgetRef ref, BuildContext context) async {
  final bytes = await ref.read(pdfBytesProvider.future);
  if (bytes == null) return;
  await Printing.layoutPdf(onLayout: (_) async => bytes);
}
```

Add imports at top:

```dart
import 'package:printing/printing.dart';
```

- [ ] **Step 3: Run the app and test export**

```bash
flutter run -d macos
```

Expected: Save/Share/Print buttons work. PDF is generated and exported.

- [ ] **Step 4: Commit**

```bash
git add lib/features/editor/editor_screen.dart
git commit -m "feat: add PDF export with save, share, and print support"
```

---

### Task 12: Web App Adaptations

**Files:**
- Create: `lib/core/web_storage.dart`
- Modify: `lib/main.dart`
- Modify: `lib/providers/profile_provider.dart`
- Modify: `lib/features/editor/editor_screen.dart`

- [ ] **Step 1: Implement web storage for profiles using LocalStorage**

```dart
// lib/core/web_storage.dart
import 'dart:convert';
// ignore: avoid_web_libraries_in_flutter
import 'dart:html' as html;
import 'package:yaml/yaml.dart';
import '../models/profile.dart';

class WebStorage {
  static const _profilesKey = 'mdo_profiles';

  static Map<String, Profile> loadProfiles() {
    final stored = html.window.localStorage[_profilesKey];
    if (stored == null) return {};
    try {
      final jsonMap = json.decode(stored) as Map<String, dynamic>;
      return jsonMap.map((key, value) {
        return MapEntry(
          key,
          Profile.fromMap(Map<String, dynamic>.from(value as Map)),
        );
      });
    } catch (_) {
      return {};
    }
  }

  static void saveProfiles(Map<String, Profile> profiles) {
    final jsonMap = profiles.map((key, profile) {
      return MapEntry(key, {
        'name': profile.name,
        'street': profile.street,
        'zip': profile.zip,
        'city': profile.city,
        if (profile.phone != null) 'phone': profile.phone,
        if (profile.email != null) 'email': profile.email,
        'template': profile.template,
        'signature_height': profile.signatureHeight,
        'print_qr': profile.printQr,
        if (profile.bank != null)
          'bank': {
            'holder': profile.bank!.holder,
            'iban': profile.bank!.iban,
            'bic': profile.bank!.bic,
            'bank_name': profile.bank!.bankName,
          },
      });
    });
    html.window.localStorage[_profilesKey] = json.encode(jsonMap);
  }
}
```

- [ ] **Step 2: Conditionally import web storage**

Create a stub for non-web platforms:

```dart
// lib/core/web_storage_stub.dart
import '../models/profile.dart';

class WebStorage {
  static Map<String, Profile> loadProfiles() => {};
  static void saveProfiles(Map<String, Profile> profiles) {}
}
```

- [ ] **Step 3: Update main.dart to handle web platform**

The `kIsWeb` branch already uses an empty ConfigLoader. For web, profiles come from LocalStorage, loaded in the provider layer.

- [ ] **Step 4: Hide file-system-only features on web**

In `editor_screen.dart`, wrap the file open button and template navigation with `!kIsWeb` checks:

```dart
if (!kIsWeb) ...[
  IconButton(
    icon: const Icon(Icons.folder_open),
    tooltip: 'Datei oeffnen',
    onPressed: () => _openFile(ref),
  ),
],
```

On web, the save button should trigger a browser download instead:

```dart
Future<void> _savePdfWeb(WidgetRef ref) async {
  final bytes = await ref.read(pdfBytesProvider.future);
  if (bytes == null) return;
  await Printing.sharePdf(bytes: bytes, filename: 'brief.pdf');
}
```

- [ ] **Step 5: Build and test web version**

```bash
flutter build web --release
```

Expected: Build succeeds. Serve `build/web/` and verify the app works in browser.

- [ ] **Step 6: Test Docker build**

```bash
docker build -t markdownoffice .
docker run -p 8080:80 markdownoffice
```

Expected: App accessible at `http://localhost:8080`.

- [ ] **Step 7: Commit**

```bash
git add lib/core/web_storage.dart lib/core/web_storage_stub.dart lib/main.dart lib/providers/profile_provider.dart lib/features/editor/editor_screen.dart
git commit -m "feat: add web app adaptations with LocalStorage profiles and browser PDF download"
```

---

### Task 13: Integration Test — Full Pipeline

**Files:**
- Create: `test/integration/full_pipeline_test.dart`

- [ ] **Step 1: Write integration test for the full data flow**

```dart
// test/integration/full_pipeline_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:markdownoffice/core/markdown_parser.dart';
import 'package:markdownoffice/core/template_engine.dart';
import 'package:markdownoffice/core/pdf_renderer.dart';
import 'package:markdownoffice/models/profile.dart';

void main() {
  test('full pipeline: markdown → parse → render PDF', () async {
    const markdown = '''---
profile: default
recipient:
  name: Max Mustermann
  street: Beispielweg 5
  zip: 10115
  city: Berlin
subject: Kuendigung Vertrag
date: 2026-04-04
closing: Mit freundlichen Gruessen
sign: false
attachments:
  - Vertragskopie
---

Sehr geehrter Herr Mustermann,

hiermit kuendige ich den oben genannten Vertrag fristgerecht.

## Begruendung

Der Vertrag ist **nicht mehr erforderlich**.

- Punkt eins
- Punkt zwei
''';

    // Step 1: Parse markdown
    final parsed = parseLetter(markdown);
    expect(parsed.letter.subject, 'Kuendigung Vertrag');
    expect(parsed.letter.recipient.name, 'Max Mustermann');
    expect(parsed.letter.attachments, ['Vertragskopie']);

    // Step 2: Render body to elements
    final bodyElements = renderMarkdown(parsed.body);
    expect(bodyElements.length, greaterThanOrEqualTo(4)); // paragraphs, heading, list items

    // Step 3: Get template and profile
    final template = TemplateEngine.builtinDin5008B();
    const profile = Profile(
      name: 'Roland Kreus',
      street: 'Musterstr. 1',
      zip: '12345',
      city: 'Berlin',
      email: 'test@example.com',
    );

    // Step 4: Render PDF
    final pdfBytes = await PdfRenderer.render(
      letter: parsed.letter,
      profile: profile,
      template: template,
      bodyElements: bodyElements,
    );

    expect(pdfBytes, isNotEmpty);
    expect(String.fromCharCodes(pdfBytes.sublist(0, 4)), '%PDF');
    expect(pdfBytes.length, greaterThan(5000)); // Should be a substantial PDF
  });

  test('markdown without frontmatter produces body elements only', () {
    const markdown = 'Einfacher Text ohne Frontmatter.';
    final fm = splitFrontmatter(markdown);
    expect(fm.yaml, isEmpty);
    final elements = renderMarkdown(fm.body);
    expect(elements, hasLength(1));
    expect(elements[0].type, ElementType.paragraph);
  });
}
```

- [ ] **Step 2: Run integration test**

```bash
flutter test test/integration/full_pipeline_test.dart
```

Expected: All tests PASS.

- [ ] **Step 3: Run all tests**

```bash
flutter test
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add test/integration/
git commit -m "test: add full pipeline integration test for markdown → PDF flow"
```

---

### Task 14: Final Cleanup and Verify

**Files:**
- Modify: various

- [ ] **Step 1: Run dart analyze**

```bash
dart analyze
```

Expected: No errors, no warnings.

- [ ] **Step 2: Run dart format**

```bash
dart format .
```

Expected: All files formatted.

- [ ] **Step 3: Run all tests**

```bash
flutter test
```

Expected: All tests PASS.

- [ ] **Step 4: Build for all available platforms**

```bash
flutter build macos
flutter build web
```

Expected: Builds succeed.

- [ ] **Step 5: Commit any formatting fixes**

```bash
git add -A
git commit -m "chore: format code and fix analysis warnings"
```

- [ ] **Step 6: Push to remote**

```bash
git push
```
