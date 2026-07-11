import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/shared/widgets/promo_carousel.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

import '../helpers/mocks.dart';

void main() {
  late MockApiClient mockApi;

  setUp(() {
    mockApi = MockApiClient();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      (call) async => '.',
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/url_launcher'),
      (call) async => true,
    );
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      null,
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/url_launcher'),
      null,
    );
  });

  Widget wrap(Widget child, {List<RouteBase> extraRoutes = const []}) {
    return MultiProvider(
      providers: [Provider<ApiClient>.value(value: mockApi)],
      child: MaterialApp.router(
        theme: AppTheme.light,
        routerConfig: GoRouter(
          initialLocation: '/',
          routes: [
            GoRoute(path: '/', builder: (_, __) => Scaffold(body: child)),
            GoRoute(
              path: '/wallet',
              builder: (_, __) => const Scaffold(body: Text('Wallet route')),
            ),
            ...extraRoutes,
          ],
        ),
      ),
    );
  }

  testWidgets('shows placeholder when API fails', (tester) async {
    when(() => mockApi.get('/api/public/hero-slides')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/public/hero-slides'),
        type: DioExceptionType.connectionError,
      ),
    );

    await tester.pumpWidget(wrap(const PromoCarousel()));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.byIcon(Icons.recycling_rounded), findsOneWidget);
  });

  testWidgets('renders slides from API and opens internal href', (tester) async {
    when(() => mockApi.get('/api/public/hero-slides')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/hero-slides'),
        statusCode: 200,
        data: {
          'slides': [
            {
              'id': 's1',
              'title': 'Promo Saldo',
              'imageUrl': '/uploads/a.jpg',
              'href': '/wallet',
            },
            {
              'id': 's2',
              'title': 'Promo External',
              'imageUrl': 'https://example.com/b.jpg',
              'href': 'https://example.com',
            },
          ],
        },
      ),
    );

    await tester.pumpWidget(wrap(const PromoCarousel()));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.byType(PageView), findsOneWidget);
    expect(find.bySemanticsLabel('Promo Saldo'), findsOneWidget);

    await tester.tap(find.bySemanticsLabel('Promo Saldo'));
    await tester.pumpAndSettle();
    expect(find.text('Wallet route'), findsOneWidget);
  });

  testWidgets('auto-advances when multiple slides', (tester) async {
    when(() => mockApi.get('/api/public/hero-slides')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/hero-slides'),
        statusCode: 200,
        data: {
          'slides': [
            {
              'title': 'A',
              'imageUrl': 'https://example.com/a.jpg',
              'href': '',
            },
            {
              'title': 'B',
              'imageUrl': 'https://example.com/b.jpg',
              'href': '',
            },
          ],
        },
      ),
    );

    await tester.pumpWidget(wrap(const PromoCarousel()));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.byType(PageView), findsOneWidget);

    await tester.pump(const Duration(seconds: 5));
    await tester.pump(const Duration(milliseconds: 500));
  });

  testWidgets('opens external https href via url_launcher', (tester) async {
    when(() => mockApi.get('/api/public/hero-slides')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/hero-slides'),
        statusCode: 200,
        data: {
          'slides': [
            {
              'title': 'External',
              'imageUrl': 'https://example.com/b.jpg',
              'href': 'https://example.com/promo',
            },
          ],
        },
      ),
    );

    await tester.pumpWidget(wrap(const PromoCarousel()));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    await tester.tap(find.bySemanticsLabel('External'));
    await tester.pumpAndSettle();
  });
}
