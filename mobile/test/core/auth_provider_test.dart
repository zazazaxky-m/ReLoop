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

    test('checkSession success sets user', () async {
      when(() => mockApi.get('/api/auth/me')).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/api/auth/me'),
          data: {
            'user': {
              'id': 'u1',
              'name': 'Sesi',
              'email': 'sesi@reloop.id',
              'role': 'ADMIN',
              'status': 'ACTIVE',
            },
          },
        ),
      );

      final user = await authProvider.checkSession();
      expect(user?.role, AppRole.ADMIN);
      expect(authProvider.isAuthenticated, isTrue);
      expect(authProvider.dashboardRoute, '/admin');
      expect(authProvider.hasRole(AppRole.ADMIN), isTrue);
      expect(authProvider.hasAnyRole([AppRole.ADMIN, AppRole.USER]), isTrue);
    });

    test('checkSession failure clears user', () async {
      when(() => mockApi.get('/api/auth/me')).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/api/auth/me'),
          type: DioExceptionType.badResponse,
          response: Response(
            requestOptions: RequestOptions(path: '/api/auth/me'),
            statusCode: 401,
          ),
        ),
      );

      final user = await authProvider.checkSession();
      expect(user, isNull);
      expect(authProvider.isAuthenticated, isFalse);
    });

    test('register success sets user', () async {
      when(() => mockApi.post('/api/auth/register', data: any(named: 'data')))
          .thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/api/auth/register'),
          data: {
            'user': {
              'id': 'u9',
              'name': 'Baru',
              'email': 'baru@reloop.id',
              'role': 'USER',
              'status': 'ACTIVE',
            },
          },
        ),
      );

      final ok = await authProvider.register(
        'Baru',
        'baru@reloop.id',
        'pass12345',
        '081234',
      );
      expect(ok, isTrue);
      expect(authProvider.user?.email, 'baru@reloop.id');
    });

    test('register DioException sets error', () async {
      when(() => mockApi.post('/api/auth/register', data: any(named: 'data')))
          .thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/api/auth/register'),
          type: DioExceptionType.badResponse,
          response: Response(
            requestOptions: RequestOptions(path: '/api/auth/register'),
            statusCode: 409,
            data: {'error': 'Email sudah terdaftar'},
          ),
        ),
      );

      final ok = await authProvider.register('X', 'x@y.com', 'p', '0');
      expect(ok, isFalse);
      expect(authProvider.error, 'Email sudah terdaftar');
    });

    test('verifyPassword returns valid flag', () async {
      when(() =>
              mockApi.post('/api/auth/verify-password', data: any(named: 'data')))
          .thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/api/auth/verify-password'),
          data: {'valid': true},
        ),
      );
      expect(await authProvider.verifyPassword('secret'), isTrue);

      when(() =>
              mockApi.post('/api/auth/verify-password', data: any(named: 'data')))
          .thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/api/auth/verify-password'),
          data: {'valid': false},
        ),
      );
      expect(await authProvider.verifyPassword('wrong'), isFalse);
    });

    test('login non-DioException sets generic error', () async {
      when(() => mockApi.post('/api/auth/login', data: any(named: 'data')))
          .thenThrow(StateError('boom'));
      final ok = await authProvider.login('a@b.com', 'pass');
      expect(ok, isFalse);
      expect(authProvider.error, 'Terjadi kesalahan. Coba lagi.');
    });

    test('register non-DioException sets generic error', () async {
      when(() => mockApi.post('/api/auth/register', data: any(named: 'data')))
          .thenThrow(FormatException('bad'));
      final ok = await authProvider.register('N', 'n@e.com', 'p', '0');
      expect(ok, isFalse);
      expect(authProvider.error, 'Terjadi kesalahan. Coba lagi.');
    });

    test('verifyPassword DioException and generic catch', () async {
      when(() =>
              mockApi.post('/api/auth/verify-password', data: any(named: 'data')))
          .thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/api/auth/verify-password'),
          type: DioExceptionType.connectionError,
        ),
      );
      expect(await authProvider.verifyPassword('x'), isFalse);
      expect(authProvider.error, isNotNull);

      when(() =>
              mockApi.post('/api/auth/verify-password', data: any(named: 'data')))
          .thenThrow(StateError('x'));
      expect(await authProvider.verifyPassword('x'), isFalse);
      expect(authProvider.error, 'Terjadi kesalahan. Coba lagi.');
    });

    test('dashboardRoute maps all roles', () async {
      Future<void> loginAs(String role, String expectedRoute) async {
        when(() => mockApi.post('/api/auth/login', data: any(named: 'data')))
            .thenAnswer(
          (_) async => Response(
            requestOptions: RequestOptions(path: '/api/auth/login'),
            data: {
              'user': {
                'id': 'u1',
                'name': 'N',
                'email': 'n@e.com',
                'role': role,
                'status': 'ACTIVE',
              },
            },
          ),
        );
        await authProvider.login('n@e.com', 'p');
        expect(authProvider.dashboardRoute, expectedRoute);
      }

      await loginAs('PENGEPUL', '/pengepul/dashboard');
      await loginAs('SUPERADMIN', '/superadmin');
      await loginAs('ADMIN', '/admin');
      await loginAs('USER', '/dashboard');
    });
  });
}
