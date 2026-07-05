import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import '../helpers/mocks.dart';

void main() {
  late MockApiClient mockApi;
  late AuthProvider authProvider;

  setUpAll(() {
    // Prevent MissingPluginException for flutter_secure_storage during unit tests
    FlutterSecureStorage.setMockInitialValues({});
  });

  setUp(() {
    mockApi = MockApiClient();
    authProvider = AuthProvider(mockApi);
  });

  group('AuthProvider Logic', () {
    test('Initial state is unauthenticated', () {
      expect(authProvider.user, isNull);
      expect(authProvider.isAuthenticated, isFalse);
      expect(authProvider.isLoading, isFalse);
      expect(authProvider.error, isNull);
      expect(authProvider.dashboardRoute, '/login');
    });

    test('Login success updates user state and routes correctly', () async {
      // Arrange
      when(() => mockApi.post(
            '/api/auth/login',
            data: any(named: 'data'),
          )).thenAnswer((_) async => Response(
            requestOptions: RequestOptions(path: '/api/auth/login'),
            statusCode: 200,
            data: {
              'user': {
                'id': 'u1',
                'name': 'Budi',
                'email': 'budi@reloop.id',
                'role': 'USER',
              }
            },
          ));

      // Act
      final success = await authProvider.login('budi@reloop.id', 'password');

      // Assert
      expect(success, isTrue);
      expect(authProvider.isAuthenticated, isTrue);
      expect(authProvider.user?.name, 'Budi');
      expect(authProvider.user?.role, AppRole.USER);
      expect(authProvider.dashboardRoute, '/dashboard');
      expect(authProvider.error, isNull);
      
      // Verify mock was called
      verify(() => mockApi.post(
            '/api/auth/login',
            data: {'email': 'budi@reloop.id', 'password': 'password'},
          )).called(1);
    });

    test('Login failure (401) sets error message', () async {
      // Arrange
      when(() => mockApi.post(
            '/api/auth/login',
            data: any(named: 'data'),
          )).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/api/auth/login'),
          type: DioExceptionType.badResponse,
          response: Response(
            requestOptions: RequestOptions(path: '/api/auth/login'),
            statusCode: 401,
            data: {'error': 'Email atau password salah'},
          ),
        ),
      );

      // Act
      final success = await authProvider.login('salah@reloop.id', 'wrongpass');

      // Assert
      expect(success, isFalse);
      expect(authProvider.isAuthenticated, isFalse);
      expect(authProvider.user, isNull);
      expect(authProvider.error, 'Email atau password salah');
    });

    test('Logout clears state', () async {
      // Simulate user is already logged in
      when(() => mockApi.post(
            '/api/auth/login',
            data: any(named: 'data'),
          )).thenAnswer((_) async => Response(
            requestOptions: RequestOptions(path: '/api/auth/login'),
            statusCode: 200,
            data: {
              'user': {
                'id': 'u1',
                'name': 'Budi',
                'email': 'budi@reloop.id',
                'role': 'USER',
              }
            },
          ));

      when(() => mockApi.post('/api/auth/logout', data: any(named: 'data')))
          .thenAnswer((_) async => Response(
                requestOptions: RequestOptions(path: '/'),
                statusCode: 200,
              ));
      when(() => mockApi.clearCookies()).thenAnswer((_) async {});

      await authProvider.login('budi@reloop.id', 'password');
      expect(authProvider.isAuthenticated, isTrue);

      // Act
      await authProvider.logout();

      // Assert
      expect(authProvider.isAuthenticated, isFalse);
      expect(authProvider.user, isNull);
      expect(authProvider.dashboardRoute, '/login');
    });
  });
}
