import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/features/auth/forgot_password_screen.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

void main() {
  testWidgets('ForgotPasswordScreen renders and can submit', (WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: const ForgotPasswordScreen(),
    ));

    expect(find.text('Reset Password'), findsOneWidget);
    expect(find.byType(TextFormField), findsOneWidget);

    await tester.enterText(find.byType(TextFormField), 'test@example.com');
    await tester.tap(find.text('Kirim Kode Reset'));
    await tester.pumpAndSettle();

    expect(find.text('Email Terkirim!'), findsOneWidget);
    expect(find.textContaining('test@example.com'), findsOneWidget);
  });
}
