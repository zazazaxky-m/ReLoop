import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/filter_chips.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

void main() {
  Widget buildTestWidget(Widget child) {
    return MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(body: child),
    );
  }

  testWidgets('ReLoopFilterChips renders options and label', (WidgetTester tester) async {
    String? selectedOption;
    
    await tester.pumpWidget(buildTestWidget(
      ReLoopFilterChips(
        label: 'Kategori',
        options: const ['A', 'B', 'C'],
        selected: selectedOption,
        onSelected: (val) {
          selectedOption = val;
        },
      )
    ));

    expect(find.text('Kategori'), findsOneWidget);
    expect(find.text('Semua'), findsOneWidget);
    expect(find.text('A'), findsOneWidget);
    expect(find.text('B'), findsOneWidget);
    expect(find.text('C'), findsOneWidget);

    await tester.tap(find.text('A'));
    expect(selectedOption, equals('A'));
  });
}
