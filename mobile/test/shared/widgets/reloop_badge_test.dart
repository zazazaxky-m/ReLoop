import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/reloop_badge.dart';
import 'package:reloop_mobile/theme/colors.dart';

void main() {
  group('ReLoopBadge', () {
    testWidgets('renders label text', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReLoopBadge(label: 'Test Badge', tone: BadgeTone.success),
          ),
        ),
      );
      expect(find.text('Test Badge'), findsOneWidget);
    });

    testWidgets('renders icon when provided', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReLoopBadge(
              label: 'Icon Badge',
              tone: BadgeTone.info,
              icon: Icons.info,
            ),
          ),
        ),
      );
      expect(find.byIcon(Icons.info), findsOneWidget);
    });

    testWidgets('renders all tone variants', (tester) async {
      for (final tone in BadgeTone.values) {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: ReLoopBadge(label: tone.name, tone: tone),
            ),
          ),
        );
        expect(find.text(tone.name), findsOneWidget);
      }
    });

    testWidgets('uses correct tone colors', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReLoopBadge(label: 'Success', tone: BadgeTone.success),
          ),
        ),
      );

      final container = tester.widget<Container>(find.byType(Container).first);
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.color, ReLoopColors.tones['success']!.bg);
      expect(decoration.border, isNotNull);
    });
  });

  group('BadgeTone', () {
    test('all tone values have corresponding colors', () {
      for (final tone in BadgeTone.values) {
        expect(ReLoopColors.tones.containsKey(tone.name), isTrue);
      }
    });
  });
}
