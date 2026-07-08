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

  testWidgets('ForgotPasswordScreen renders and can submit', (WidgetTester tester) async {
    when(() => mockApi.post(any(), data: any(named: 'data')))
        .thenAnswer((_) async => Response(requestOptions: RequestOptions(path: ''), data: {}));

    await tester.pumpWidget(MultiProvider(
      providers: [Provider<ApiClient>.value(value: mockApi)],
      child: MaterialApp(
        theme: AppTheme.light,
        home: const ForgotPasswordScreen(),
      ),
    ));

    expect(find.text('Reset Password'), findsOneWidget);
    expect(find.byType(TextFormField), findsOneWidget);

    await tester.enterText(find.byType(TextFormField), 'test@example.com');
    await tester.tap(find.text('Kirim Tautan Reset'));
    await tester.pumpAndSettle();

    expect(find.text('Email Terkirim!'), findsOneWidget);
    expect(find.textContaining('test@example.com'), findsOneWidget);
  });
}
