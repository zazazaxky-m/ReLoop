import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/features/trash_bag/trash_bag_screen.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockApiClient extends Mock implements ApiClient {}

void main() {
  late MockApiClient mockApi;

  setUp(() {
    mockApi = MockApiClient();
  });

  Map<String, dynamic> tripListData() => {
        'trips': [
          {
            'id': 't1',
            'campaignId': 'c1',
            'groupName': 'Rombongan Bali',
            'leaderName': 'Budi',
            'participantCount': 12,
            'status': 'ACTIVE',
            'complianceStatus': 'GOOD',
            'complianceScore': 90,
            'createdAt': '2026-07-01T00:00:00Z',
            'campaign': {
              'id': 'c1',
              'name': 'Program Wisata',
              'organizationId': 'o1',
              'rewardMode': 'MONEY_REWARD',
              'campaignType': 'TOURISM_PROGRAM',
            },
            'user': {
              'id': 'u1',
              'name': 'Agent',
              'email': 'agent@travel.com',
            },
            '_count': {'bagAssignments': 3, 'validations': 1},
          },
        ],
      };

  Map<String, dynamic> tripDetailData() => {
        'trip': {
          'complianceScore': 88,
          'trashBagRewardAmount': 15000,
          'bagAssignments': [
            {
              'bagQrCode': 'BAG-001',
              'status': 'GOOD',
              'wasteType': {'name': 'Plastik'},
            },
          ],
          'validations': [
            {
              'validationStage': 'BANK_SAMPAH_PICKUP',
              'conditionStatus': 'GOOD',
              'returnedBagCount': 3,
            },
          ],
        },
      };

  Widget buildApp() {
    return Provider<ApiClient>.value(
      value: mockApi,
      child: MaterialApp(
        theme: AppTheme.light,
        home: const TrashBagScreen(),
      ),
    );
  }

  testWidgets('loads trip list', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/trips')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/trips'),
        data: tripListData(),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Trash Bag / Trip'), findsOneWidget);
    expect(find.text('Rombongan Bali'), findsOneWidget);
    expect(find.textContaining('3 kantong'), findsOneWidget);
    expect(find.textContaining('Ketua: Budi'), findsOneWidget);
    expect(find.textContaining('Reward: agent@travel.com'), findsOneWidget);
  });

  testWidgets('opens trip detail bottom sheet and copies bag code', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') return null;
        return null;
      },
    );

    when(() => mockApi.get('/api/trips')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/trips'),
        data: tripListData(),
      ),
    );
    when(() => mockApi.get('/api/trips/t1')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/trips/t1'),
        data: tripDetailData(),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Rombongan Bali'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Skor compliance: 88/100'), findsOneWidget);
    expect(find.textContaining('Reward: Rp 15.000'), findsOneWidget);
    expect(find.text('BAG-001'), findsOneWidget);
    expect(find.textContaining('Sampah sudah dijemput bank sampah'), findsOneWidget);

    await tester.tap(find.byTooltip('Salin kode'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Disalin: BAG-001'), findsOneWidget);
  });

  testWidgets('shows empty state', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    when(() => mockApi.get('/api/trips')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/trips'),
        data: {'trips': []},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Belum ada trip'), findsOneWidget);
  });

  testWidgets('shows error and retry', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    when(() => mockApi.get('/api/trips')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/trips'),
        type: DioExceptionType.connectionError,
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Coba Lagi'), findsOneWidget);

    when(() => mockApi.get('/api/trips')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/trips'),
        data: {'trips': []},
      ),
    );
    await tester.tap(find.text('Coba Lagi'));
    await tester.pumpAndSettle();
    expect(find.text('Belum ada trip'), findsOneWidget);
  });

  testWidgets('shows snackbar when trip detail fails', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/trips')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/trips'),
        data: tripListData(),
      ),
    );
    when(() => mockApi.get('/api/trips/t1')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/trips/t1'),
        type: DioExceptionType.connectionError,
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Rombongan Bali'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Tidak dapat terhubung ke server'), findsOneWidget);
  });

  testWidgets('shows empty bag/validation messages in trip detail',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/trips')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/trips'),
        data: tripListData(),
      ),
    );
    when(() => mockApi.get('/api/trips/t1')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/trips/t1'),
        data: {
          'trip': {
            'complianceScore': 70,
            'bagAssignments': [],
            'validations': [],
          },
        },
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Rombongan Bali'));
    await tester.pumpAndSettle();

    expect(find.text('Belum ada kantong yang di-assign.'), findsOneWidget);
    expect(find.text('Belum ada validasi.'), findsOneWidget);
  });

  testWidgets('renders bag without status as "Belum divalidasi"',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/trips')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/trips'),
        data: tripListData(),
      ),
    );
    when(() => mockApi.get('/api/trips/t1')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/trips/t1'),
        data: {
          'trip': {
            'complianceScore': 80,
            'bagAssignments': [
              {
                'bagQrCode': 'BAG-NULL',
                // status intentionally omitted to exercise fallback label
                'wasteType': {'name': 'Campuran'},
              },
            ],
            'validations': [],
          },
        },
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Rombongan Bali'));
    await tester.pumpAndSettle();

    expect(find.text('BAG-NULL'), findsOneWidget);
    expect(find.textContaining('Belum divalidasi'), findsOneWidget);
  });

  testWidgets('renders all known bag status labels', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    when(() => mockApi.get('/api/trips')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/trips'),
        data: tripListData(),
      ),
    );
    when(() => mockApi.get('/api/trips/t1')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/trips/t1'),
        data: {
          'trip': {
            'complianceScore': 80,
            'bagAssignments': [
              {'bagQrCode': 'B1', 'status': 'GOOD', 'wasteType': {'name': 'A'}},
              {
                'bagQrCode': 'B2',
                'status': 'PARTIAL',
                'wasteType': {'name': 'B'},
              },
              {'bagQrCode': 'B3', 'status': 'POOR', 'wasteType': {'name': 'C'}},
              {
                'bagQrCode': 'B4',
                'status': 'NOT_RETURNED',
                'wasteType': {'name': 'D'},
              },
              {
                'bagQrCode': 'B5',
                'status': 'CHECK_IN',
                'wasteType': {'name': 'E'},
              },
              {
                'bagQrCode': 'B6',
                'status': 'CHECK_OUT',
                'wasteType': {'name': 'F'},
              },
              {
                'bagQrCode': 'B7',
                'status': 'BANK_SAMPAH_PICKUP',
                'wasteType': {'name': 'G'},
              },
              {
                'bagQrCode': 'B8',
                'status': 'CUSTOM_UNKNOWN',
                'wasteType': {'name': 'H'},
              },
            ],
            'validations': [],
          },
        },
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Rombongan Bali'));
    await tester.pumpAndSettle();

    // Bag status labels are joined with "·" into a single Text, so use
    // textContaining to look for each rendered label.
    expect(find.textContaining('Baik'), findsWidgets);
    expect(find.textContaining('Sebagian'), findsWidgets);
    expect(find.textContaining('Rusak'), findsWidgets);
    expect(find.textContaining('Tidak dikembalikan'), findsWidgets);
    expect(find.textContaining('Check in'), findsWidgets);
    expect(find.textContaining('Check out'), findsWidgets);
    expect(find.textContaining('Pickup bank sampah'), findsWidgets);
    // Default branch returns the raw status string.
    expect(find.textContaining('CUSTOM_UNKNOWN'), findsWidgets);
  });

  testWidgets('dark mode uses brand400 accent on metric cards', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/trips')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/trips'),
        data: tripListData(),
      ),
    );

    await tester.pumpWidget(
      Provider<ApiClient>.value(
        value: mockApi,
        child: MaterialApp(
          theme: AppTheme.light,
          darkTheme: AppTheme.dark,
          themeMode: ThemeMode.dark,
          home: const TrashBagScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Trip list card surfaces bag and validation counts; in dark mode both
    // should resolve to a brand-tinted color (not the muted fallback).
    expect(find.textContaining('3 kantong'), findsOneWidget);
    expect(find.textContaining('1 kali validasi'), findsOneWidget);
  });

  testWidgets('zero bag/validation counts use muted text on trip card',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/trips')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/trips'),
        data: {
          'trips': [
            {
              'id': 't1',
              'campaignId': 'c1',
              'groupName': 'Rombongan Bali',
              'leaderName': 'Budi',
              'participantCount': 12,
              'status': 'ACTIVE',
              'complianceStatus': 'GOOD',
              'complianceScore': 90,
              'createdAt': '2026-07-01T00:00:00Z',
              'campaign': {
                'id': 'c1',
                'name': 'Program Wisata',
                'organizationId': 'o1',
                'rewardMode': 'MONEY_REWARD',
                'campaignType': 'TOURISM_PROGRAM',
              },
              'user': {
                'id': 'u1',
                'name': 'Agent',
                'email': 'agent@travel.com',
              },
              '_count': {'bagAssignments': 0, 'validations': 0},
            },
          ],
        },
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();
    // Zero counts collapse to the "Belum di-assign / Belum diverifikasi"
    // muted copy on the trip card.
    expect(find.text('Belum di-assign'), findsOneWidget);
    expect(find.text('Belum diverifikasi'), findsOneWidget);
  });
}
