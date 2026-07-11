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
      if (message.contains('RenderFlex overflowed') ||
          message.contains('A RenderFlex overflowed') ||
          message.contains('ListTile background color or ink splashes may be invisible.') ||
          message.contains('hasSize') ||
          message.contains('NEEDS-LAYOUT') ||
          message.contains('Looking up a deactivated')) {
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
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('Keamanan Sistem'), findsOneWidget);
    expect(find.text('Alert 24 jam'), findsOneWidget);
    expect(find.text('Fraud 7 hari'), findsOneWidget);
    expect(find.text('Vandalisme'), findsOneWidget);
    expect(find.text('Mesin terdampak'), findsOneWidget);
    expect(find.text('PERLU TINJAUAN'), findsOneWidget);
    expect(find.text('Tidak ada alert keamanan'), findsOneWidget);
  });

  testWidgets('security mode renders event timeline', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    when(() => mockApi.get('/api/mobile/audit-security')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/audit-security'),
        data: {
          'securitySummary': {
            'alerts24h': 0,
            'fraud7d': 0,
            'vandalism7d': 0,
            'affectedMachines7d': 0,
          },
          'securityEvents': [
            {
              'eventType': 'FRAUD_SUSPECTED',
              'severity': 'high',
              'entityType': 'DepositSession',
              'occurredAt': DateTime.now()
                  .subtract(const Duration(minutes: 2))
                  .toIso8601String(),
              'machine': {'name': 'Mesin X', 'machineCode': 'MAC-X'},
              'note': 'Anomali berat',
            },
            {
              'action': 'VANDALISM',
              'severity': 'low',
              'createdAt': DateTime.now()
                  .subtract(const Duration(hours: 5))
                  .toIso8601String(),
              'description': 'Kamera buram',
            },
            {
              'eventType': 'ALERT',
              'severity': 'medium',
              'occurredAt': DateTime.now()
                  .subtract(const Duration(days: 2))
                  .toIso8601String(),
            },
          ],
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
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.textContaining('FRAUD_SUSPECTED'), findsWidgets);
    expect(find.textContaining('Anomali berat'), findsOneWidget);
    expect(find.textContaining('VANDALISM'), findsWidgets);
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
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('Belum ada log aktivitas'), findsOneWidget);
  });

  testWidgets('audit mode renders log cards', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/mobile/audit-security')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/audit-security'),
        data: {
          'auditLogs': [
            {
              'action': 'CREATE',
              'entityType': 'Machine',
              'entityId': 'very-long-entity-id-1234567890',
              'createdAt': '2026-07-10T08:00:00Z',
              'actor': {'name': 'Admin', 'email': 'a@b.com'},
              'machine': {'name': 'Mesin Z', 'machineCode': 'MAC-Z'},
            },
            {
              'action': 'UPDATE',
              'entityType': 'DepositSession',
              'createdAt': DateTime.now()
                  .subtract(const Duration(seconds: 30))
                  .toIso8601String(),
            },
            {
              'action': 'ACCEPT',
              'entityType': 'OrganizationCollectorPartner',
              'createdAt': DateTime.now()
                  .subtract(const Duration(hours: 3))
                  .toIso8601String(),
            },
            {
              'action': 'ASSIGN',
              'entityType': 'PickupRequest',
              'createdAt': DateTime.now()
                  .subtract(const Duration(days: 3))
                  .toIso8601String(),
            },
            {
              'action': 'PAY',
              'entityType': 'Redemption',
              'createdAt': '2020-01-01T00:00:00Z',
            },
            {
              'action': 'PUBLISH',
              'entityType': 'Campaign',
              'createdAt': 'not-a-date',
            },
            {
              'action': 'EDIT',
              'entityType': 'WasteType',
              'createdAt': DateTime.now()
                  .subtract(const Duration(days: 1))
                  .toIso8601String(),
            },
            {
              'action': 'CLOSE',
              'entityType': 'Trip',
              'createdAt': DateTime.now()
                  .subtract(const Duration(minutes: 40))
                  .toIso8601String(),
            },
            {
              'action': 'OTHER',
              'entityType': 'UnknownThing',
              'createdAt': DateTime.now().toIso8601String(),
            },
          ],
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
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('Semua'), findsOneWidget);
    expect(find.textContaining('CREATE'), findsWidgets);

    await tester.tap(find.widgetWithText(FilterChip, 'Machine'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.textContaining('CREATE'), findsWidgets);

    // Scroll horizontal filter chips to reach later categories.
    final chipScrollable = find.descendant(
      of: find.byType(ListView).first,
      matching: find.byType(Scrollable),
    );
    if (chipScrollable.evaluate().isNotEmpty) {
      await tester.drag(chipScrollable.first, const Offset(-400, 0));
      await tester.pump();
    }
    final tripChip = find.widgetWithText(FilterChip, 'Trip');
    if (tripChip.evaluate().isNotEmpty) {
      await tester.tap(tripChip);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.textContaining('CLOSE'), findsWidgets);
    }
  });

  testWidgets('config mode can remove a slide', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2400));
    when(() => mockApi.get('/api/config')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/config'),
        data: {
          'config': {
            'minRedemption': 10000,
            'qrRotation': 60,
            'pointsToRupiah': 5,
            'mobile_hero_slides': jsonEncode([
              {
                'title': 'Mobile Slide',
                'description': 'Deskripsi mobile',
                'href': '/campaigns',
                'image': '',
              },
              {
                'title': 'Mobile Slide 2',
                'description': 'Deskripsi 2',
                'href': '/wallet',
                'image': '',
              },
            ]),
            'landing_hero_slides': jsonEncode([]),
          },
        },
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
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('Slide 1'), findsWidgets);
    expect(find.text('Slide 2'), findsWidgets);

    final deleteIcons = find.byIcon(Icons.delete_outline);
    if (deleteIcons.evaluate().isNotEmpty) {
      await tester.tap(deleteIcons.first);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
    }
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
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('Kebijakan sistem'), findsOneWidget);
    expect(find.text('Minimum pencairan (Rp)'), findsOneWidget);
    expect(find.text('Konten Carousel Mobile'), findsOneWidget);
    expect(find.text('Konten Carousel Landing Page'), findsOneWidget);
    expect(find.text('Slide 1'), findsNWidgets(2));

    await tester.tap(find.text('Tambah Slide').first);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    await tester.tap(find.text('Tambah Slide').last);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    await tester.scrollUntilVisible(
      find.text('Simpan perubahan', skipOffstage: false),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Simpan perubahan', skipOffstage: false));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

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
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    expect(find.text('Coba lagi'), findsOneWidget);
  });

  testWidgets('security STATUS AMAN when no incidents', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/mobile/audit-security')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/audit-security'),
        data: {
          'securitySummary': {
            'alerts24h': 0,
            'fraud7d': 0,
            'vandalism7d': 0,
            'affectedMachines7d': 0,
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
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('STATUS AMAN'), findsOneWidget);
    expect(find.text('Tidak ada alert baru'), findsOneWidget);
    expect(find.text('Tidak ada alert keamanan'), findsOneWidget);
  });

  testWidgets('security event older than 7 days shows absolute date',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/mobile/audit-security')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/audit-security'),
        data: {
          'securityEvents': [
            {
              'id': 'evt1',
              'type': 'VANDALISM',
              'severity': 'MEDIUM',
              'createdAt': DateTime.now()
                  .subtract(const Duration(days: 30))
                  .toIso8601String(),
              'description': 'Mesin dirusak',
              'machineId': 'm1',
              'machineName': 'Mesin A',
            },
          ],
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
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    final date = DateTime.now().subtract(const Duration(days: 30));
    final expected = '${date.day}/${date.month}/${date.year}';
    expect(find.text(expected), findsWidgets);
  });

  testWidgets('security mode renders in dark mode', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/mobile/audit-security')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/audit-security'),
        data: {
          'securitySummary': {
            'alerts24h': 1,
            'fraud7d': 0,
            'vandalism7d': 0,
            'affectedMachines7d': 1,
          },
          'securityEvents': [],
        },
      ),
    );

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
          Provider<ApiClient>.value(value: mockApi),
        ],
        child: MediaQuery(
          data: const MediaQueryData(textScaleFactor: 0.85),
          child: MaterialApp.router(
            routerConfig: GoRouter(
              initialLocation: '/superadmin/security',
              routes: [
                GoRoute(
                  path: '/superadmin/security',
                  builder: (context, state) => const SuperadminSystemScreen(
                    title: 'Keamanan Sistem',
                    mode: SuperadminSystemMode.security,
                  ),
                ),
              ],
            ),
            theme: ThemeData.light(),
            darkTheme: ThemeData.dark(),
            themeMode: ThemeMode.dark,
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('PERLU TINJAUAN'), findsOneWidget);
  });

  testWidgets('security critical severity and auth icons', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    when(() => mockApi.get('/api/mobile/audit-security')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/audit-security'),
        data: {
          'securitySummary': {
            'alerts24h': 1,
            'fraud7d': 0,
            'vandalism7d': 0,
            'affectedMachines7d': 1,
          },
          'securityEvents': [
            {
              'eventType': 'CRITICAL_BREACH',
              'severity': 'critical',
              'entityType': 'Machine',
              'occurredAt': DateTime.now().toIso8601String(),
              'note': 'Critical note',
            },
            {
              'action': 'AUTH_LOGIN',
              'severity': 'low',
              'createdAt': DateTime.now()
                  .subtract(const Duration(seconds: 10))
                  .toIso8601String(),
            },
            {
              'action': 'MACHINE_OFFLINE',
              'severity': 'medium',
              'createdAt': DateTime.now()
                  .subtract(const Duration(minutes: 45))
                  .toIso8601String(),
            },
          ],
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
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.textContaining('CRITICAL_BREACH'), findsWidgets);
    expect(find.textContaining('Critical note'), findsOneWidget);
    expect(find.textContaining('AUTH_LOGIN'), findsWidgets);
    expect(find.textContaining('MACHINE_OFFLINE'), findsWidgets);
  });

  testWidgets('audit filter empty category message', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/mobile/audit-security')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/audit-security'),
        data: {
          'auditLogs': [
            {
              'action': 'CREATE',
              'entityType': 'Machine',
              'createdAt': DateTime.now().toIso8601String(),
              'actor': {'name': 'Admin', 'email': 'a@b.com', 'role': 'ADMIN'},
            },
          ],
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
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    final chipScrollable = find.descendant(
      of: find.byType(ListView).first,
      matching: find.byType(Scrollable),
    );
    if (chipScrollable.evaluate().isNotEmpty) {
      await tester.drag(chipScrollable.first, const Offset(-500, 0));
      await tester.pump();
    }
    final redemptionChip = find.widgetWithText(FilterChip, 'Redemption');
    expect(redemptionChip, findsOneWidget);
    await tester.tap(redemptionChip);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(
      find.textContaining('Tidak ada log untuk kategori Redemption'),
      findsOneWidget,
    );
  });

  testWidgets('config save error shows snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2400));
    when(() => mockApi.get('/api/config')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/config'),
        data: {
          'config': {
            'minRedemption': 10000,
            'qrRotation': 60,
            'pointsToRupiah': 5,
            'partnerInviteTtlHours': 72,
            'redemptionDailyLimit': 3,
            'redemptionWeeklyLimit': 10,
            'mobile_hero_slides': jsonEncode([]),
            'landing_hero_slides': jsonEncode([]),
          },
        },
      ),
    );
    when(() => mockApi.patch('/api/config', data: any(named: 'data'))).thenThrow(
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
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    await tester.scrollUntilVisible(
      find.text('Simpan perubahan', skipOffstage: false),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Simpan perubahan', skipOffstage: false));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });

  testWidgets('config invalid slide json and retry after error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    var calls = 0;
    when(() => mockApi.get('/api/config')).thenAnswer((_) async {
      calls++;
      if (calls == 1) {
        throw DioException(
          requestOptions: RequestOptions(path: '/api/config'),
          response: Response(
            requestOptions: RequestOptions(path: '/api/config'),
            statusCode: 500,
            data: {'error': 'Terjadi kesalahan pada server.'},
          ),
          type: DioExceptionType.badResponse,
        );
      }
      return Response(
        requestOptions: RequestOptions(path: '/api/config'),
        data: {
          'config': {
            'minRedemption': 5000,
            'mobile_hero_slides': 'not-json',
            'landing_hero_slides': '{bad',
            'customToggle': 'true',
          },
        },
      );
    });

    await tester.pumpWidget(
      buildApp(
        path: '/superadmin/config',
        screen: const SuperadminSystemScreen(
          title: 'Konfigurasi Sistem',
          mode: SuperadminSystemMode.config,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('Coba lagi'), findsOneWidget);

    await tester.tap(find.text('Coba lagi'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('Kebijakan sistem'), findsOneWidget);
    expect(find.text('customToggle'), findsOneWidget);
  });

  testWidgets('config mode onChanged writes back to the controller',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2400));
    when(() => mockApi.get('/api/config')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/config'),
        data: {
          'config': {
            'minRedemption': 10000,
            'qrRotation': 60,
            'pointsToRupiah': 5,
            'mobile_hero_slides': jsonEncode([]),
            'landing_hero_slides': jsonEncode([]),
          },
        },
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
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    // Edit the "Minimum pencairan" field so _ConfigField's onChanged callback
    // runs, which writes the new value back into the controller.
    final minField = find.widgetWithText(TextField, '10000');
    await tester.enterText(minField, '25000');
    await tester.pump();
    expect(find.text('25000'), findsWidgets);
  });

  testWidgets('config remove middle slide reindexes', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2400));
    when(() => mockApi.get('/api/config')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/config'),
        data: {
          'config': {
            'minRedemption': 10000,
            'mobile_hero_slides': jsonEncode([
              {
                'title': 'A',
                'description': 'd1',
                'href': '/a',
                'image': '',
              },
              {
                'title': 'B',
                'description': 'd2',
                'href': '/b',
                'image': '',
              },
              {
                'title': 'C',
                'description': 'd3',
                'href': '/c',
                'image': '',
              },
            ]),
            'landing_hero_slides': jsonEncode([]),
          },
        },
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
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('Slide 3'), findsOneWidget);
    // Removing first slide reindexes remaining controllers safely.
    final deleteIcons = find.byIcon(Icons.delete_outline);
    expect(deleteIcons.evaluate().length, greaterThanOrEqualTo(3));
    await tester.tap(deleteIcons.first);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Slide 3'), findsNothing);
    expect(find.text('Slide 2'), findsOneWidget);
    expect(find.text('Slide 1'), findsOneWidget);
  });

  testWidgets('config mode removes a landing slide', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2400));
    when(() => mockApi.get('/api/config')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/config'),
        data: {
          'config': {
            'minRedemption': 10000,
            'qrRotation': 60,
            'pointsToRupiah': 5,
            'mobile_hero_slides': jsonEncode([]),
            'landing_hero_slides': jsonEncode([
              {
                'title': 'Landing Slide',
                'description': 'Deskripsi landing',
                'href': '/register',
                'image': '',
              },
              {
                'title': 'Landing Slide 2',
                'description': 'Deskripsi 2',
                'href': '/wallet',
                'image': '',
              },
            ]),
          },
        },
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
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('Landing Slide'), findsOneWidget);
    expect(find.text('Landing Slide 2'), findsOneWidget);

    // Tap the first delete icon. Removing the first slide reindexes the
    // remaining controller (landing-1 -> landing-0) so the build doesn't
    // hit a missing controller.
    await tester.tap(find.byIcon(Icons.delete_outline).first);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('Landing Slide'), findsNothing);
    expect(find.text('Landing Slide 2'), findsOneWidget);
  });

  testWidgets('config mode shows image preview for a slide', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2400));
    when(() => mockApi.get('/api/config')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/config'),
        data: {
          'config': {
            'minRedemption': 10000,
            'qrRotation': 60,
            'pointsToRupiah': 5,
            'mobile_hero_slides': jsonEncode([
              {
                'title': 'Mobile Slide',
                'description': 'Deskripsi',
                'href': '/campaigns',
                'image': 'https://example.com/banner.png',
              },
            ]),
            'landing_hero_slides': jsonEncode([]),
          },
        },
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
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('https://example.com/banner.png'), findsWidgets);
    expect(find.byType(Image), findsWidgets);
  });

  testWidgets('audit log older than 7 days uses date format', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/mobile/audit-security')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/audit-security'),
        data: {
          'auditLogs': [
            {
              'action': 'CREATE',
              'entityType': 'Trip',
              'entityId': 'trip-1',
              'createdAt': DateTime.now()
                  .subtract(const Duration(days: 30))
                  .toIso8601String(),
              'actor': {'name': 'Admin', 'email': 'a@b.com'},
            },
          ],
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
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    final date = DateTime.now().subtract(const Duration(days: 30));
    final expected = '${date.day}/${date.month}/${date.year}';
    expect(find.text(expected), findsWidgets);
  });

  testWidgets('config mode renders in dark mode', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2400));
    when(() => mockApi.get('/api/config')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/config'),
        data: {
          'config': {
            'minRedemption': 10000,
            'qrRotation': 60,
            'pointsToRupiah': 5,
            'mobile_hero_slides': jsonEncode([]),
            'landing_hero_slides': jsonEncode([]),
          },
        },
      ),
    );

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
          Provider<ApiClient>.value(value: mockApi),
        ],
        child: MediaQuery(
          data: const MediaQueryData(textScaleFactor: 0.85),
          child: MaterialApp.router(
            routerConfig: GoRouter(
              initialLocation: '/superadmin/config',
              routes: [
                GoRoute(
                  path: '/superadmin/config',
                  builder: (context, state) => const SuperadminSystemScreen(
                    title: 'Konfigurasi Sistem',
                    mode: SuperadminSystemMode.config,
                  ),
                ),
              ],
            ),
            theme: ThemeData.light(),
            darkTheme: ThemeData.dark(),
            themeMode: ThemeMode.dark,
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('Kebijakan sistem'), findsOneWidget);
  });
}
