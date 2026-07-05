import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/shared/widgets/promo_carousel.dart';
import '../helpers/mocks.dart';

void main() {
  late MockApiClient mockApi;

  setUp(() {
    mockApi = MockApiClient();
  });

  Widget wrapInMaterial(Widget child) {
    return MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: mockApi),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: child,
        ),
      ),
    );
  }

  group('PromoCarousel Widget Test', () {
    testWidgets('T1: Rendering data carousel dari API', (tester) async {
      when(() => mockApi.get('/api/public/hero-slides')).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/api/public/hero-slides'),
          statusCode: 200,
          data: {
            'slides': [
              {
                'id': 's1',
                'title': 'Promo Saldo',
                'imageUrl': 'https://example.com/image1.jpg', // Ignore NetworkImage load fail
              }
            ]
          },
        ),
      );

      // Disable network image fetch failing tests using standard workaround
      await tester.runAsync(() async {
        await tester.pumpWidget(wrapInMaterial(const PromoCarousel()));
        await tester.pumpAndSettle();
      });

      // Verify PageView is rendered
      expect(find.byType(PageView), findsOneWidget);
    });
  });
}
