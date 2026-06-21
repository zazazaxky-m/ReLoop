import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/status_badge.dart';

void main() {
  group('StatusBadge', () {
    testWidgets('renders ONLINE badge correctly', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: StatusBadge(statusKey: 'ONLINE')),
        ),
      );
      expect(find.text('Online'), findsOneWidget);
    });

    testWidgets('renders OFFLINE badge correctly', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: StatusBadge(statusKey: 'OFFLINE')),
        ),
      );
      expect(find.text('Offline'), findsOneWidget);
    });

    testWidgets('renders ACTIVE badge correctly', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: StatusBadge(statusKey: 'ACTIVE')),
        ),
      );
      expect(find.text('Aktif'), findsOneWidget);
    });

    testWidgets('renders COMPLETED badge correctly', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: StatusBadge(statusKey: 'COMPLETED')),
        ),
      );
      expect(find.text('Selesai'), findsOneWidget);
    });

    testWidgets('renders PENDING badge correctly', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: StatusBadge(statusKey: 'PENDING')),
        ),
      );
      expect(find.text('Pending'), findsOneWidget);
    });

    testWidgets('renders unknown status with humanized text', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: StatusBadge(statusKey: 'NEW_STATUS')),
        ),
      );
      expect(find.text('New Status'), findsOneWidget);
    });

    testWidgets('renders all pickup statuses', (tester) async {
      final statuses = [
        ('ASSIGNED', 'Ditugaskan'),
        ('ON_THE_WAY', 'Dalam Perjalanan'),
        ('ARRIVED', 'Tiba'),
        ('COLLECTED', 'Diambil'),
      ];

      for (final (key, label) in statuses) {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(body: StatusBadge(statusKey: key)),
          ),
        );
        expect(find.text(label), findsOneWidget);
      }
    });
  });
}
