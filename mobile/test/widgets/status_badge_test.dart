import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/status_badge.dart';
import 'package:reloop_mobile/shared/widgets/reloop_badge.dart';

void main() {
  Widget wrapInMaterial(Widget child) {
    return MaterialApp(
      home: Scaffold(
        body: Center(child: child),
      ),
    );
  }

  group('StatusBadge Widget Test', () {
    testWidgets('T1: Status SUCCESS', (tester) async {
      await tester.pumpWidget(wrapInMaterial(const StatusBadge(statusKey: 'SUCCESS')));

      expect(find.text('Sukses'), findsOneWidget);
      
      final badge = tester.widget<ReLoopBadge>(find.byType(ReLoopBadge));
      expect(badge.tone, BadgeTone.success);
      expect(badge.icon, Icons.check_circle);
    });

    testWidgets('T2: Status PENDING', (tester) async {
      await tester.pumpWidget(wrapInMaterial(const StatusBadge(statusKey: 'PENDING')));

      expect(find.text('Pending'), findsOneWidget);
      
      final badge = tester.widget<ReLoopBadge>(find.byType(ReLoopBadge));
      expect(badge.tone, BadgeTone.warning);
      expect(badge.icon, Icons.schedule);
    });

    testWidgets('T3: Status DANGER / FAILED', (tester) async {
      await tester.pumpWidget(wrapInMaterial(const StatusBadge(statusKey: 'FAILED')));

      expect(find.text('Gagal'), findsOneWidget);
      
      final badge = tester.widget<ReLoopBadge>(find.byType(ReLoopBadge));
      expect(badge.tone, BadgeTone.danger);
      expect(badge.icon, Icons.cancel);
    });

    testWidgets('T4: Fallback untuk status tidak dikenal', (tester) async {
      await tester.pumpWidget(wrapInMaterial(const StatusBadge(statusKey: 'UNKNOWN_STATUS_TEXT')));

      expect(find.text('Unknown Status Text'), findsOneWidget); // Humanize logic
      
      final badge = tester.widget<ReLoopBadge>(find.byType(ReLoopBadge));
      expect(badge.tone, BadgeTone.neutral);
    });
  });
}
