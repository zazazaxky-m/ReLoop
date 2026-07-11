import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/features/legal/privacy_screen.dart';
import 'package:reloop_mobile/features/legal/terms_screen.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

void main() {
  testWidgets('TermsScreen renders sections', (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: const TermsScreen(),
    ));

    expect(find.text('Syarat & Ketentuan'), findsWidgets);
    expect(find.text('Syarat & Ketentuan ReLoop'), findsOneWidget);
    expect(find.textContaining('1. Pendahuluan'), findsOneWidget);
    expect(find.textContaining('7. Perubahan'), findsOneWidget);
  });

  testWidgets('PrivacyScreen renders sections', (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: const PrivacyScreen(),
    ));

    expect(find.text('Kebijakan Privasi'), findsWidgets);
    expect(find.text('Kebijakan Privasi ReLoop'), findsOneWidget);
    expect(find.textContaining('Data yang Kami Kumpulkan'), findsOneWidget);
    expect(find.textContaining('privacy@reloop.id'), findsOneWidget);
  });
}
