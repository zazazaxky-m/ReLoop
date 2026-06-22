import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/reloop_card.dart';

void main() {
  group('ReLoopCard', () {
    testWidgets('renders child widget', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReLoopCard(child: const Text('Card Content')),
          ),
        ),
      );
      expect(find.text('Card Content'), findsOneWidget);
    });

    testWidgets('applies decoration', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReLoopCard(child: const SizedBox(height: 50)),
          ),
        ),
      );
      final container = tester.widget<Container>(find.byType(Container).first);
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.border, isNotNull);
      expect(decoration.borderRadius, isNotNull);
      expect(decoration.color, isNotNull);
    });
  });

  group('ReLoopCardTitle', () {
    testWidgets('renders title text', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReLoopCardTitle(title: 'Card Title'),
          ),
        ),
      );
      expect(find.text('Card Title'), findsOneWidget);
    });
  });
}
