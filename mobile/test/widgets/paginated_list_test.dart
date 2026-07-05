import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/paginated_list.dart';

void main() {
  Widget wrapInMaterial(Widget child) {
    return MaterialApp(
      home: Scaffold(
        body: child,
      ),
    );
  }

  group('PaginatedList Widget Test', () {
    testWidgets('T1: Menampilkan list item ketika data berhasil diambil', (tester) async {
      await tester.pumpWidget(
        wrapInMaterial(
          PaginatedList<String>(
            fetcher: (cursor) async {
              return PaginatedResult(
                items: ['Item 1', 'Item 2'],
                hasMore: false,
              );
            },
            itemBuilder: (item) => ListTile(title: Text(item)),
          ),
        ),
      );

      // Pompa untuk menunggu future selesai
      await tester.pumpAndSettle();

      expect(find.text('Item 1'), findsOneWidget);
      expect(find.text('Item 2'), findsOneWidget);
    });

    testWidgets('T2: Menampilkan empty state ketika list kosong', (tester) async {
      await tester.pumpWidget(
        wrapInMaterial(
          PaginatedList<String>(
            fetcher: (cursor) async {
              return PaginatedResult(
                items: [],
                hasMore: false,
              );
            },
            itemBuilder: (item) => ListTile(title: Text(item)),
            emptyState: const Text('Data Kosong!'),
          ),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.text('Data Kosong!'), findsOneWidget);
    });

    testWidgets('T3: Menampilkan pesan error ketika fetcher gagal', (tester) async {
      await tester.pumpWidget(
        wrapInMaterial(
          PaginatedList<String>(
            fetcher: (cursor) async {
              throw Exception('Network Error');
            },
            itemBuilder: (item) => ListTile(title: Text(item)),
          ),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.text('Gagal memuat data'), findsOneWidget);
    });
  });
}
