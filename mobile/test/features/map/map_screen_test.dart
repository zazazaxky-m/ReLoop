import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/features/map/map_screen.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/theme/app_theme.dart';
import 'package:provider/provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';
import 'package:flutter_map/flutter_map.dart';

class MockApiClient extends Mock implements ApiClient {}
class MockAuthProvider extends Mock implements AuthProvider {}

void main() {
  late MockApiClient mockApi;
  late MockAuthProvider mockAuth;

  setUp(() {
    mockApi = MockApiClient();
    mockAuth = MockAuthProvider();
    
    when(() => mockAuth.user).thenReturn(
      CurrentUser(id: '1', name: 'User', email: 'user@a.com', role: AppRole.USER, status: 'ACTIVE')
    );
  });

  Widget buildScreen() {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
        Provider<ApiClient>.value(value: mockApi),
      ],
      child: MaterialApp(
        theme: AppTheme.light,
        home: const MapScreen(),
      ),
    );
  }

  testWidgets('MapScreen renders and loads data', (WidgetTester tester) async {
    when(() => mockApi.get(any(), queryParameters: any(named: 'queryParameters'))).thenAnswer((invocation) async {
      final path = invocation.positionalArguments[0] as String;
      if (path.contains('machines')) {
        return Response(
          requestOptions: RequestOptions(path: path),
          data: {
            'machines': [
              {
                'id': 'm1',
                'name': 'Mesin A',
                'machineCode': 'MAC-123',
                'status': 'ONLINE',
                'latitude': -6.2088,
                'longitude': 106.8456,
                'fillLevelPercent': 50
              }
            ]
          }
        );
      }
      if (path.contains('campaigns')) {
        return Response(
          requestOptions: RequestOptions(path: path),
          data: {
            'campaigns': []
          }
        );
      }
      return Response(requestOptions: RequestOptions(path: path), data: {});
    });

    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    expect(find.byType(FlutterMap), findsOneWidget);
    expect(find.textContaining('1 mesin'), findsOneWidget);
  });
}
