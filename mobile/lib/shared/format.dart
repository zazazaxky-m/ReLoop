/// Shared, dependency-free formatting helpers so currency/date/relative-time
/// rendering is consistent across screens instead of each screen reinventing
/// its own private helper.
library;

/// Formats an integer rupiah amount as `Rp1.234.567` (no decimals).
String formatRupiah(num amount) {
  final rounded = amount.round();
  final negative = rounded < 0;
  final digits = rounded.abs().toString().replaceAllMapped(
        RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
        (match) => '${match[1]}.',
      );
  return '${negative ? '-' : ''}Rp$digits';
}

/// Groups a plain integer with thousands separators, e.g. `1234` -> `1.234`.
String formatThousands(num value) {
  return value.round().toString().replaceAllMapped(
        RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
        (match) => '${match[1]}.',
      );
}

/// Short relative time in Indonesian (e.g. "5 menit lalu", "2 jam lalu"),
/// falling back to an absolute date for anything older than a week.
String formatRelativeTime(DateTime date) {
  final diff = DateTime.now().difference(date);
  if (diff.inSeconds < 60) return 'Baru saja';
  if (diff.inMinutes < 60) return '${diff.inMinutes} menit lalu';
  if (diff.inHours < 24) return '${diff.inHours} jam lalu';
  if (diff.inDays < 7) return '${diff.inDays} hari lalu';
  return formatDateTime(date);
}

/// Parses an ISO string and returns short relative time, or the raw string
/// when it cannot be parsed.
String formatRelativeIso(String iso) {
  final parsed = DateTime.tryParse(iso);
  if (parsed == null) return iso;
  return formatRelativeTime(parsed.toLocal());
}

/// Absolute `d/m/y H:MM` local timestamp.
String formatDateTime(DateTime date) {
  final minute = date.minute.toString().padLeft(2, '0');
  return '${date.day}/${date.month}/${date.year} ${date.hour}:$minute';
}

/// Parses an ISO string to an absolute local timestamp, or returns the raw
/// string when it cannot be parsed.
String formatDateTimeIso(String iso) {
  final parsed = DateTime.tryParse(iso);
  if (parsed == null) return iso;
  return formatDateTime(parsed.toLocal());
}
