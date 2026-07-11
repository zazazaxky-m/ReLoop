import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/state_views.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

void main() {
  Widget wrap(Widget child) {
    return MaterialApp(theme: AppTheme.light, home: Scaffold(body: child));
  }

  testWidgets('ReLoopEmptyState renders title and description', (tester) async {
    await tester.pumpWidget(wrap(
      const ReLoopEmptyState(
        icon: Icons.inbox_outlined,
        title: 'Kosong',
        description: 'Belum ada data',
      ),
    ));

    expect(find.text('Kosong'), findsOneWidget);
    expect(find.text('Belum ada data'), findsOneWidget);
    expect(find.byIcon(Icons.inbox_outlined), findsOneWidget);
  });

  testWidgets('ReLoopEmptyState compact mode renders', (tester) async {
    await tester.pumpWidget(wrap(
      const ReLoopEmptyState(
        icon: Icons.inbox_outlined,
        title: 'Kosong compact',
        compact: true,
      ),
    ));

    expect(find.text('Kosong compact'), findsOneWidget);
  });

  testWidgets('ReLoopErrorState without retry', (tester) async {
    await tester.pumpWidget(wrap(
      const ReLoopErrorState(message: 'Gagal memuat'),
    ));

    expect(find.text('Gagal memuat'), findsOneWidget);
    expect(find.text('Coba lagi'), findsNothing);
  });

  testWidgets('ReLoopErrorState calls onRetry', (tester) async {
    var tapped = false;
    await tester.pumpWidget(wrap(
      ReLoopErrorState(
        message: 'Gagal',
        onRetry: () => tapped = true,
      ),
    ));

    await tester.tap(find.text('Coba lagi'));
    await tester.pump();
    expect(tapped, isTrue);
  });

  testWidgets('ReLoopErrorStateScrollable fills viewport', (tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 800));
    await tester.pumpWidget(wrap(
      ReLoopErrorStateScrollable(
        message: 'Error scrollable',
        onRetry: () {},
      ),
    ));

    expect(find.text('Error scrollable'), findsOneWidget);
    expect(find.byType(SingleChildScrollView), findsOneWidget);
  });
}
