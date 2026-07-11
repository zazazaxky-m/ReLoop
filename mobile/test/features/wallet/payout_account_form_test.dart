import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/features/wallet/payout_account_form.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockApiClient extends Mock implements ApiClient {}

void main() {
  late MockApiClient mockApi;

  setUp(() {
    mockApi = MockApiClient();
  });

  Widget buildApp() {
    return Provider<ApiClient>.value(
      value: mockApi,
      child: MaterialApp(
        theme: AppTheme.light,
        home: const PayoutAccountForm(),
      ),
    );
  }

  testWidgets('renders form fields', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Tambah Akun Pencairan'), findsOneWidget);
    expect(find.text('Pilih Provider'), findsOneWidget);
    expect(find.text('Simpan Akun'), findsOneWidget);
  });

  testWidgets('validates required fields', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Simpan Akun'));
    await tester.pumpAndSettle();

    expect(find.text('Pilih provider'), findsWidgets);
    expect(find.text('Wajib diisi'), findsOneWidget);
  });

  testWidgets('saves account and pops on success', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    when(() => mockApi.post('/api/payout-accounts', data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/payout-accounts'),
        data: {'ok': true},
      ),
    );

    await tester.pumpWidget(
      Provider<ApiClient>.value(
        value: mockApi,
        child: MaterialApp(
          theme: AppTheme.light,
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const PayoutAccountForm()),
                  );
                },
                child: const Text('Open Form'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open Form'));
    await tester.pumpAndSettle();

    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('GOPAY').last);
    await tester.pumpAndSettle();

    expect(find.text('Nomor HP Terdaftar'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField).first, '08123456789');
    await tester.enterText(find.byType(TextFormField).at(1), 'Farhan');
    await tester.tap(find.text('Simpan Akun'));
    await tester.pumpAndSettle();

    expect(find.text('Akun pencairan berhasil ditambahkan'), findsOneWidget);
    expect(find.text('Open Form'), findsOneWidget);
    verify(() => mockApi.post('/api/payout-accounts', data: any(named: 'data'))).called(1);
  });

  testWidgets('shows snackbar on API error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    when(() => mockApi.post('/api/payout-accounts', data: any(named: 'data'))).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/payout-accounts'),
        type: DioExceptionType.connectionError,
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('BANK').last);
    await tester.pumpAndSettle();

    expect(find.text('Nomor Rekening'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField).first, '1234567890');
    await tester.tap(find.text('Simpan Akun'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Tidak dapat terhubung ke server'), findsOneWidget);
  });

  testWidgets('updates label for OTHER provider', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('OTHER').last);
    await tester.pumpAndSettle();

    expect(find.text('ID Akun / Tujuan'), findsOneWidget);
  });
}
