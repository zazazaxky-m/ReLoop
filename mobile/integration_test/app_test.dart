import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group('App Integration', () {
    testWidgets('app launches and renders', (tester) async {
      await tester.pumpWidget(const Placeholder());
      await tester.pumpAndSettle();
      expect(find.byType(Placeholder), findsOneWidget);
    });
  });
}
