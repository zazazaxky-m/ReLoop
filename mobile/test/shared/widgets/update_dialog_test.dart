import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/update_dialog.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

void main() {
  testWidgets('ForceUpdateDialog renders content and cannot pop', (WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: const Scaffold(
        body: ForceUpdateDialog(
          latestVersion: '2.0.0',
          changelog: 'Added new features',
        ),
      ),
    ));

    expect(find.text('Update Tersedia'), findsOneWidget);
    expect(find.textContaining('Versi 2.0.0'), findsOneWidget);
    expect(find.text('Added new features'), findsOneWidget);
    expect(find.text('Update Sekarang'), findsOneWidget);
  });
}
