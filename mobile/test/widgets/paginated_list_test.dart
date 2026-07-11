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
    testWidgets('T1: Menampilkan list item ketika data berhasil diambil',
        (tester) async {
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

      await tester.pumpAndSettle();

      expect(find.text('Item 1'), findsOneWidget);
      expect(find.text('Item 2'), findsOneWidget);
    });

    testWidgets('T2: Menampilkan empty state ketika list kosong',
        (tester) async {
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

    testWidgets('T3: Menampilkan pesan error ketika fetcher gagal',
        (tester) async {
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

    testWidgets('custom loadingState and Coba Lagi refresh', (tester) async {
      var calls = 0;
      await tester.pumpWidget(
        wrapInMaterial(
          PaginatedList<String>(
            fetcher: (cursor) async {
              calls++;
              if (calls == 1) throw Exception('fail');
              return PaginatedResult(items: ['Recovered'], hasMore: false);
            },
            itemBuilder: (item) => ListTile(title: Text(item)),
            loadingState: () => const Text('Custom loading'),
          ),
        ),
      );

      expect(find.text('Custom loading'), findsOneWidget);
      await tester.pumpAndSettle();
      expect(find.text('Gagal memuat data'), findsOneWidget);

      await tester.tap(find.text('Coba Lagi'));
      await tester.pumpAndSettle();
      expect(find.text('Recovered'), findsOneWidget);
    });

    testWidgets('scroll near end loads next page', (tester) async {
      var page = 0;
      await tester.binding.setSurfaceSize(const Size(400, 600));
      await tester.pumpWidget(
        wrapInMaterial(
          PaginatedList<String>(
            fetcher: (cursor) async {
              page++;
              if (page == 1) {
                return PaginatedResult(
                  items: List.generate(20, (i) => 'Row $i'),
                  nextCursor: 'c2',
                  hasMore: true,
                );
              }
              return PaginatedResult(
                items: ['Row 20'],
                hasMore: false,
              );
            },
            itemBuilder: (item) => SizedBox(
              height: 80,
              child: ListTile(title: Text(item)),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Row 0'), findsOneWidget);

      await tester.drag(find.byType(ListView), const Offset(0, -5000));
      await tester.pumpAndSettle();
      expect(find.text('Row 20'), findsOneWidget);
    });
  });
}
