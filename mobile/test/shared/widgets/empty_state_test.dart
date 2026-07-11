import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/empty_state.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

void main() {
  Widget wrap(Widget child) {
    return MaterialApp(theme: AppTheme.light, home: Scaffold(body: child));
  }

  testWidgets('EmptyState renders title and description', (tester) async {
    await tester.pumpWidget(
      wrap(
        const EmptyState(
          icon: Icons.inbox_outlined,
          title: 'Kosong',
          description: 'Belum ada data',
        ),
      ),
    );

    expect(find.text('Kosong'), findsOneWidget);
    expect(find.text('Belum ada data'), findsOneWidget);
  });

  testWidgets('EmptyState action branch is tappable', (tester) async {
    var tapped = false;
    await tester.pumpWidget(
      wrap(
        EmptyState(
          icon: Icons.add,
          title: 'Kosong',
          action: TextButton(
            onPressed: () => tapped = true,
            child: const Text('Tambah'),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Tambah'));
    await tester.pump();
    expect(tapped, isTrue);
  });
}
