import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/features/notifications/notifications_screen.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockApiClient extends Mock implements ApiClient {}

void main() {
  late MockApiClient mockApi;

  setUp(() {
    mockApi = MockApiClient();
  });

  Widget buildApp() {
    final router = GoRouter(
      initialLocation: '/notifications',
      routes: [
        GoRoute(
          path: '/notifications',
          builder: (_, __) => const NotificationsScreen(),
        ),
        GoRoute(
          path: '/wallet',
          builder: (_, __) => const Scaffold(body: Text('WALLET ROUTE')),
        ),
      ],
    );

    return Provider<ApiClient>.value(
      value: mockApi,
      child: MaterialApp.router(
        theme: AppTheme.light,
        routerConfig: router,
      ),
    );
  }

  List<Map<String, dynamic>> notificationsJson() => [
        {
          'id': 'n1',
          'type': 'REDEMPTION_STATUS',
          'title': 'Pencairan diproses',
          'body': 'Pengajuan Anda sedang diproses.',
          'createdAt': '2026-07-10T08:00:00Z',
          'readAt': null,
          'data': {'route': '/wallet'},
        },
        {
          'id': 'n2',
          'type': 'PICKUP_ASSIGNED',
          'title': 'Tugas pickup baru',
          'body': 'Ada tugas pickup untuk Anda.',
          'createdAt': '2026-07-09T08:00:00Z',
          'readAt': '2026-07-09T09:00:00Z',
        },
        {
          'id': 'n3',
          'type': 'MACHINE_FULL',
          'title': 'Mesin penuh',
          'body': 'Mesin A sudah penuh.',
          'createdAt': '2026-07-08T08:00:00Z',
          'readAt': null,
        },
        {
          'id': 'n4',
          'type': 'MACHINE_FRAUD',
          'title': 'Indikasi fraud',
          'body': 'Periksa mesin B.',
          'createdAt': 'not-a-date',
          'readAt': 'also-bad',
          'dataJson': {'route': '/wallet', 'id': 'x'},
        },
        {
          'id': 'n5',
          'type': 'OTHER',
          'title': 'Umum',
          'body': 'Notifikasi lain.',
          'createdAt': '',
          'readAt': null,
        },
      ];

  testWidgets('loads notifications list', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/notifications')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/notifications'),
        data: {'notifications': notificationsJson()},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Notifikasi'), findsOneWidget);
    expect(find.text('Pencairan diproses'), findsOneWidget);
    expect(find.text('Tugas pickup baru'), findsOneWidget);
    expect(find.text('Tandai semua'), findsOneWidget);
  });

  testWidgets('marks one notification read and navigates', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/notifications')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/notifications'),
        data: {'notifications': notificationsJson()},
      ),
    );
    when(() => mockApi.patch('/api/notifications', data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/notifications'),
        data: {'ok': true},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Pencairan diproses'));
    await tester.pumpAndSettle();

    expect(find.text('WALLET ROUTE'), findsOneWidget);
    verify(() => mockApi.patch('/api/notifications', data: {'ids': ['n1']})).called(1);
  });

  testWidgets('marks all notifications read', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/notifications')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/notifications'),
        data: {'notifications': notificationsJson()},
      ),
    );
    when(() => mockApi.patch('/api/notifications', data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/notifications'),
        data: {'ok': true},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Tandai semua'));
    await tester.pumpAndSettle();

    verify(() => mockApi.patch('/api/notifications', data: {})).called(1);
    expect(find.text('Tandai semua'), findsNothing);
  });

  testWidgets('shows empty state', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    when(() => mockApi.get('/api/notifications')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/notifications'),
        data: {'notifications': []},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Belum ada notifikasi.'), findsOneWidget);
  });

  testWidgets('shows error and retry', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    when(() => mockApi.get('/api/notifications')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/notifications'),
        type: DioExceptionType.connectionError,
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Coba lagi'), findsOneWidget);

    when(() => mockApi.get('/api/notifications')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/notifications'),
        data: {'notifications': []},
      ),
    );
    await tester.tap(find.text('Coba lagi'));
    await tester.pumpAndSettle();
    expect(find.text('Belum ada notifikasi.'), findsOneWidget);
  });
}
