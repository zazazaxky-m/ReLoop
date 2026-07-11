import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/features/auth/forgot_password_screen.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/theme/app_theme.dart';
import 'package:provider/provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';

class MockApiClient extends Mock implements ApiClient {}

void main() {
  late MockApiClient mockApi;

  setUp(() {
    mockApi = MockApiClient();
  });

  Widget wrap(Widget child) {
    return MultiProvider(
      providers: [Provider<ApiClient>.value(value: mockApi)],
      child: MaterialApp(
        theme: AppTheme.light,
        home: child,
      ),
    );
  }

  testWidgets('ForgotPasswordScreen renders and can submit', (tester) async {
    when(() => mockApi.post(any(), data: any(named: 'data'))).thenAnswer(
      (_) async => Response(requestOptions: RequestOptions(path: ''), data: {}),
    );

    await tester.pumpWidget(wrap(const ForgotPasswordScreen()));

    expect(find.text('Reset Password'), findsOneWidget);
    expect(find.byType(TextFormField), findsOneWidget);

    await tester.enterText(find.byType(TextFormField), 'test@example.com');
    await tester.tap(find.text('Kirim Tautan Reset'));
    await tester.pumpAndSettle();

    expect(find.text('Email Terkirim!'), findsOneWidget);
    expect(find.textContaining('test@example.com'), findsOneWidget);
  });

  testWidgets('shows error banner on API failure', (tester) async {
    when(() => mockApi.post(any(), data: any(named: 'data'))).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/auth/forgot-password'),
        type: DioExceptionType.badResponse,
        response: Response(
          requestOptions: RequestOptions(path: '/api/auth/forgot-password'),
          statusCode: 429,
          data: {'error': 'Terlalu banyak permintaan'},
        ),
      ),
    );

    await tester.pumpWidget(wrap(const ForgotPasswordScreen()));
    await tester.enterText(find.byType(TextFormField), 'fail@example.com');
    await tester.tap(find.text('Kirim Tautan Reset'));
    await tester.pumpAndSettle();

    expect(find.text('Terlalu banyak permintaan'), findsOneWidget);
    expect(find.text('Email Terkirim!'), findsNothing);
  });

  testWidgets('success back button pops', (tester) async {
    when(() => mockApi.post(any(), data: any(named: 'data'))).thenAnswer(
      (_) async => Response(requestOptions: RequestOptions(path: ''), data: {}),
    );

    await tester.pumpWidget(
      MultiProvider(
        providers: [Provider<ApiClient>.value(value: mockApi)],
        child: MaterialApp(
          theme: AppTheme.light,
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const ForgotPasswordScreen(),
                    ),
                  );
                },
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField), 'ok@example.com');
    await tester.tap(find.text('Kirim Tautan Reset'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Kembali ke Login'));
    await tester.pumpAndSettle();
    expect(find.text('Open'), findsOneWidget);
  });

  testWidgets('validation requires email', (tester) async {
    await tester.pumpWidget(wrap(const ForgotPasswordScreen()));
    await tester.tap(find.text('Kirim Tautan Reset'));
    await tester.pumpAndSettle();
    expect(find.text('Email wajib diisi'), findsOneWidget);
    verifyNever(() => mockApi.post(any(), data: any(named: 'data')));
  });
}
