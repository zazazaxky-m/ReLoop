import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/reloop_button.dart';

void main() {
  group('ReLoopButton', () {
    testWidgets('renders label text', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReLoopButton(label: 'Test Label', onPressed: () {}),
          ),
        ),
      );
      expect(find.text('Test Label'), findsOneWidget);
    });

    testWidgets('renders icon when provided', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReLoopButton(
              label: 'With Icon',
              icon: Icons.check,
              onPressed: () {},
            ),
          ),
        ),
      );
      expect(find.byIcon(Icons.check), findsOneWidget);
    });

    testWidgets('shows loading indicator', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReLoopButton(
              label: 'Loading',
              onPressed: () {},
              isLoading: true,
            ),
          ),
        ),
      );
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('disabled when onPressed is null', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: ReLoopButton(label: 'Disabled')),
        ),
      );
      final button = tester.widget<ElevatedButton>(find.byType(ElevatedButton));
      expect(button.onPressed, isNull);
    });

    testWidgets('calls onPressed', (tester) async {
      var tapped = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReLoopButton(
              label: 'Tap',
              onPressed: () => tapped = true,
            ),
          ),
        ),
      );
      await tester.tap(find.text('Tap'));
      expect(tapped, isTrue);
    });

    testWidgets('renders danger variant', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReLoopButton(
              label: 'Danger',
              variant: ReLoopButtonVariant.danger,
              onPressed: () {},
            ),
          ),
        ),
      );
      expect(find.text('Danger'), findsOneWidget);
    });
  });
}
