import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/error_boundary.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

void main() {
  Widget buildTestWidget(Widget child) {
    return MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(body: child),
    );
  }

  testWidgets('ErrorBoundary renders child correctly', (WidgetTester tester) async {
    await tester.pumpWidget(buildTestWidget(
      const ErrorBoundary(child: Text('Child Content')),
    ));
    expect(find.text('Child Content'), findsOneWidget);
  });

  testWidgets('ErrorBoundary errorScreen renders message and retry button', (WidgetTester tester) async {
    bool retried = false;
    
    await tester.pumpWidget(buildTestWidget(
      ErrorBoundary.errorScreen(
        message: 'Error Test',
        onRetry: () {
          retried = true;
        },
      ),
    ));

    expect(find.text('Error Test'), findsOneWidget);
    expect(find.text('Coba Lagi'), findsOneWidget);
    expect(find.byIcon(Icons.refresh), findsOneWidget);

    await tester.tap(find.text('Coba Lagi'));
    expect(retried, isTrue);
  });
}
