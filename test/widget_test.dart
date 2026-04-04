import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:markdownoffice/main.dart';

void main() {
  testWidgets('MarkdownOffice app smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(child: MarkdownOfficeApp()),
    );

    expect(find.text('MarkdownOffice'), findsOneWidget);
  });
}
