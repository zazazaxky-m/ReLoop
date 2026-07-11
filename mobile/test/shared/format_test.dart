import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/format.dart';

void main() {
  group('formatRupiah', () {
    test('formats positive amounts', () {
      expect(formatRupiah(0), 'Rp0');
      expect(formatRupiah(1234), 'Rp1.234');
      expect(formatRupiah(1234567), 'Rp1.234.567');
    });

    test('formats negatives and rounds', () {
      expect(formatRupiah(-1500), '-Rp1.500');
      expect(formatRupiah(1.6), 'Rp2');
    });
  });

  group('formatThousands', () {
    test('groups digits', () {
      expect(formatThousands(0), '0');
      expect(formatThousands(1234), '1.234');
      expect(formatThousands(1234567.4), '1.234.567');
    });
  });

  group('formatRelativeTime', () {
    test('returns Baru saja for recent times', () {
      expect(formatRelativeTime(DateTime.now()), 'Baru saja');
    });

    test('returns minutes hours and days', () {
      final now = DateTime.now();
      expect(formatRelativeTime(now.subtract(const Duration(minutes: 5))), '5 menit lalu');
      expect(formatRelativeTime(now.subtract(const Duration(hours: 3))), '3 jam lalu');
      expect(formatRelativeTime(now.subtract(const Duration(days: 2))), '2 hari lalu');
    });

    test('falls back to absolute date after a week', () {
      final old = DateTime.now().subtract(const Duration(days: 10));
      expect(formatRelativeTime(old), formatDateTime(old));
    });
  });

  group('formatRelativeIso', () {
    test('parses valid iso and returns raw for invalid', () {
      final iso = DateTime.now().toUtc().toIso8601String();
      expect(formatRelativeIso(iso), 'Baru saja');
      expect(formatRelativeIso('not-a-date'), 'not-a-date');
    });
  });

  group('formatDateTime', () {
    test('formats local timestamp', () {
      final date = DateTime(2024, 1, 5, 9, 7);
      expect(formatDateTime(date), '5/1/2024 9:07');
    });
  });

  group('formatDateTimeIso', () {
    test('parses valid iso and returns raw for invalid', () {
      expect(formatDateTimeIso('not-a-date'), 'not-a-date');
      final parsed = formatDateTimeIso('2024-01-05T09:07:00.000');
      expect(parsed, contains('2024'));
      expect(parsed, contains(':'));
    });
  });
}
