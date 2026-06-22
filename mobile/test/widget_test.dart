import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/theme/colors.dart';
import 'package:reloop_mobile/shared/widgets/status_badge.dart';

void main() {
  group('App Core', () {
    test('ReLoopColors has all required tones', () {
      final requiredTones = ['success', 'warning', 'danger', 'info', 'neutral', 'brand'];
      for (final tone in requiredTones) {
        expect(ReLoopColors.tones.containsKey(tone), isTrue);
      }
    });

    test('ReLoopColors brand colors are correct', () {
      expect(ReLoopColors.brand500, const Color(0xFF16A34A));
      expect(ReLoopColors.brand600, const Color(0xFF15803D));
    });

    test('ReLoopColors dark variants exist', () {
      expect(ReLoopColors.backgroundDark, isNotNull);
      expect(ReLoopColors.surfaceDark, isNotNull);
      expect(ReLoopColors.foregroundDark, isNotNull);
    });

    testWidgets('StatusBadge renders all test statuses', (tester) async {
      final testStatuses = ['ACTIVE', 'COMPLETED', 'PENDING'];

      for (final status in testStatuses) {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(body: StatusBadge(statusKey: status)),
          ),
        );
        expect(find.byType(StatusBadge), findsOneWidget);
      }
    });
  });
}
