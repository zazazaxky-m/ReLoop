import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/metric_card.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

void main() {
  testWidgets('MetricCard renders label, value and icon', (WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(
        body: const MetricCard(
          label: 'Total Poin',
          value: '100',
          hint: 'This is a hint',
          icon: Icons.star,
        ),
      ),
    ));

    expect(find.text('Total Poin'), findsOneWidget);
    expect(find.text('100'), findsOneWidget);
    expect(find.text('This is a hint'), findsOneWidget);
    expect(find.byIcon(Icons.star), findsOneWidget);
  });
}
