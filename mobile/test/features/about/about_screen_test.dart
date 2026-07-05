import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/features/about/about_screen.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

void main() {
  testWidgets('AboutScreen renders properly', (WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: const AboutScreen(),
    ));

    expect(find.text('Tentang'), findsWidgets);
    expect(find.text('ReLoop'), findsWidgets);
    expect(find.text('Versi 1.0.0'), findsOneWidget);
    expect(find.text('Platform'), findsOneWidget);
    expect(find.text('Flutter'), findsOneWidget);
  });
}
