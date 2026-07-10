import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/superadmin/superadmin_system_screen.dart';

class MockApiClient extends Mock implements ApiClient {}
class MockAuthProvider extends Mock implements AuthProvider {}

void main() {
  late MockApiClient mockApi;
  late MockAuthProvider mockAuth;
  void Function(FlutterErrorDetails)? previousOnError;

  setUp(() {
    previousOnError = FlutterError.onError;
    FlutterError.onError = (details) {
      final message = details.exceptionAsString();
      if (message.contains('RenderFlex overflowed by 1.00 pixels on the bottom.') ||
          message.contains('ListTile background color or ink splashes may be invisible.')) {
        return;
      }
      previousOnError?.call(details);
    };
    mockApi = MockApiClient();
    mockAuth = MockAuthProvider();
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'u1',
        name: 'Super Admin',
        email: 'super@example.com',
        role: AppRole.SUPERADMIN,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.logout()).thenAnswer((_) async {});
  });

  tearDown(() {
    FlutterError.onError = previousOnError;
  });

  Widget buildApp({
    required String path,
    required Widget screen,
  }) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
        Provider<ApiClient>.value(value: mockApi),
      ],
      child: MediaQuery(
        data: const MediaQueryData(textScaleFactor: 0.85),
        child: MaterialApp.router(
          routerConfig: GoRouter(
            initialLocation: path,
            routes: [
              GoRoute(
                path: path,
                builder: (context, state) => screen,
              ),
            ],
          ),
        ),
      ),
    );
  }

  testWidgets('security mode renders metrics and alerts', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/mobile/audit-security')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/audit-security'),
        data: {
          'securitySummary': {
            'alerts24h': 2,
            'fraud7d': 1,
            'vandalism7d': 3,
            'affectedMachines7d': 4,
          },
          'securityEvents': [],
        },
      ),
    );

    await tester.pumpWidget(
      buildApp(
        path: '/superadmin/security',
        screen: const SuperadminSystemScreen(
          title: 'Keamanan Sistem',
          mode: SuperadminSystemMode.security,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Keamanan Sistem'), findsOneWidget);
    expect(find.text('Alert 24 jam'), findsOneWidget);
    expect(find.text('Fraud 7 hari'), findsOneWidget);
    expect(find.text('Vandalisme'), findsOneWidget);
    expect(find.text('Mesin terdampak'), findsOneWidget);
    expect(find.text('PERLU TINJAUAN'), findsOneWidget);
    expect(find.text('Tidak ada alert keamanan'), findsOneWidget);
  });

  testWidgets('audit mode filters logs to empty state', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/mobile/audit-security')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/audit-security'),
        data: {
          'auditLogs': [],
        },
      ),
    );

    await tester.pumpWidget(
      buildApp(
        path: '/superadmin/audit',
        screen: const SuperadminSystemScreen(
          title: 'Audit Sistem',
          mode: SuperadminSystemMode.audit,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Belum ada log aktivitas'), findsOneWidget);
  });

  testWidgets('config mode renders editors and saves', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2400));
    when(() => mockApi.get('/api/config')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/config'),
        data: {
          'config': {
            'minRedemption': 10000,
            'qrRotation': 60,
            'pointsToRupiah': 5,
            'customToggle': 'true',
            'mobile_hero_slides': jsonEncode([
              {
                'title': 'Mobile Slide',
                'description': 'Deskripsi mobile',
                'href': '/campaigns',
                'image': '',
              },
            ]),
            'landing_hero_slides': jsonEncode([
              {
                'title': 'Landing Slide',
                'description': 'Deskripsi landing',
                'href': '/register',
                'image': '',
              },
            ]),
          },
        },
      ),
    );
    when(() => mockApi.patch('/api/config', data: any(named: 'data'))).thenAnswer(
      (_) async => Response(requestOptions: RequestOptions(path: '/api/config')),
    );

    await tester.pumpWidget(
      buildApp(
        path: '/superadmin/config',
        screen: const SuperadminSystemScreen(
          title: 'Konfigurasi Sistem',
          mode: SuperadminSystemMode.config,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Kebijakan sistem'), findsOneWidget);
    expect(find.text('Minimum pencairan (Rp)'), findsOneWidget);
    expect(find.text('Konten Carousel Mobile'), findsOneWidget);
    expect(find.text('Konten Carousel Landing Page'), findsOneWidget);
    expect(find.text('Slide 1'), findsNWidgets(2));

    await tester.tap(find.text('Tambah Slide').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tambah Slide').last);
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('Simpan perubahan', skipOffstage: false),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Simpan perubahan', skipOffstage: false));
    await tester.pumpAndSettle();

    verify(() => mockApi.patch('/api/config', data: any(named: 'data'))).called(1);
    expect(find.text('Konfigurasi berhasil disimpan.'), findsOneWidget);
  });

  testWidgets('shows retry state on load error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/config')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/config'),
        response: Response(
          requestOptions: RequestOptions(path: '/api/config'),
          statusCode: 500,
          data: {'error': 'Terjadi kesalahan pada server.'},
        ),
        type: DioExceptionType.badResponse,
      ),
    );

    await tester.pumpWidget(
      buildApp(
        path: '/superadmin/config',
        screen: const SuperadminSystemScreen(
          title: 'Konfigurasi Sistem',
          mode: SuperadminSystemMode.config,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    expect(find.text('Coba lagi'), findsOneWidget);
  });
}
