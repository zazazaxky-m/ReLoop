import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/features/machine/machine_report_form.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockApiClient extends Mock implements ApiClient {}

void main() {
  late MockApiClient mockApi;

  setUp(() {
    mockApi = MockApiClient();
  });

  Widget buildForm() {
    return MultiProvider(
      providers: [Provider<ApiClient>.value(value: mockApi)],
      child: MaterialApp(
        theme: AppTheme.light,
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) =>
                          const MachineReportForm(machineCode: 'MAC-1'),
                    ),
                  );
                },
                child: const Text('Open form'),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> openForm(WidgetTester tester) async {
    await tester.pumpWidget(buildForm());
    await tester.tap(find.text('Open form'));
    await tester.pumpAndSettle();
  }

  testWidgets('renders form and requires issue type', (tester) async {
    await openForm(tester);

    expect(find.text('Laporkan Masalah'), findsOneWidget);
    expect(find.textContaining('MAC-1'), findsOneWidget);

    await tester.tap(find.text('Kirim Laporan'));
    await tester.pumpAndSettle();

    expect(find.text('Pilih jenis masalah'), findsWidgets);
    verifyNever(() => mockApi.post(any(), data: any(named: 'data')));
  });

  testWidgets('submits report successfully and pops', (tester) async {
    when(() => mockApi.post(any(), data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/machines/MAC-1/report'),
        data: {'ok': true},
      ),
    );

    await openForm(tester);

    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mesin rusak').last);
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField), 'Tidak menyala');
    await tester.tap(find.text('Kirim Laporan'));
    await tester.pumpAndSettle();

    // Form pops after success; snackbar lives on the popped route.
    expect(find.text('Open form'), findsOneWidget);
    expect(find.text('Laporkan Masalah'), findsNothing);
    verify(() => mockApi.post(
          '/api/machines/MAC-1/report',
          data: {
            'issueType': 'RUSAK',
            'description': 'Tidak menyala',
          },
        )).called(1);
  });

  testWidgets('shows error snackbar on failure', (tester) async {
    when(() => mockApi.post(any(), data: any(named: 'data'))).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/machines/MAC-1/report'),
        type: DioExceptionType.connectionError,
      ),
    );

    await openForm(tester);

    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Penuh/Tidak bisa menampung').last);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Kirim Laporan'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Tidak dapat terhubung'), findsOneWidget);
  });
}
