import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/campaigns/campaigns_screen.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockApiClient extends Mock implements ApiClient {}
class MockAuthProvider extends Mock implements AuthProvider {}

void main() {
  late MockApiClient mockApi;
  late MockAuthProvider mockAuth;

  setUp(() {
    mockApi = MockApiClient();
    mockAuth = MockAuthProvider();
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'u1',
        name: 'User',
        email: 'user@reloop.id',
        role: AppRole.USER,
        status: 'ACTIVE',
      ),
    );

    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('dev.fluttercommunity.plus/share'),
      (call) async => 'ok',
    );
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('dev.fluttercommunity.plus/share'),
      null,
    );
  });

  Widget buildApp() {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
        Provider<ApiClient>.value(value: mockApi),
      ],
      child: MaterialApp(
        theme: AppTheme.light,
        home: const CampaignsScreen(),
      ),
    );
  }

  List<Map<String, dynamic>> campaignsJson() => [
        {
          'id': 'c1',
          'name': 'Program Sekolah Hijau',
          'description': 'Setor sampah di sekolah dan dapat reward.',
          'campaignType': 'SCHOOL_PROGRAM',
          'visibility': 'PUBLIC',
          'status': 'ACTIVE',
          'organization': {'name': 'Org Sekolah'},
          'startAt': '2026-01-01T00:00:00Z',
          'endAt': '2026-12-31T00:00:00Z',
          'rewardMultiplier': 1.5,
        },
        {
          'id': 'c2',
          'name': 'Private Domain Only',
          'campaignType': 'EVENT',
          'visibility': 'PRIVATE',
          'status': 'ACTIVE',
          'allowedEmailDomains': ['@reloop.id'],
          'startAt': '2026-01-01T00:00:00Z',
          'endAt': '2026-12-31T00:00:00Z',
        },
        {
          'id': 'c3',
          'name': 'Draft Campaign',
          'campaignType': 'TRASH_BAG',
          'visibility': 'PUBLIC',
          'status': 'DRAFT',
        },
        {
          'id': 'c4',
          'name': 'Tourism Active',
          'campaignType': 'TOURISM_PROGRAM',
          'visibility': 'PUBLIC',
          'status': 'ACTIVE',
          'startAt': '2026-01-01T00:00:00Z',
          'endAt': '2026-12-31T00:00:00Z',
        },
      ];

  testWidgets('lists eligible active campaigns', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/public/campaigns')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/campaigns'),
        data: {'campaigns': campaignsJson()},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Program Aktif'), findsOneWidget);
    expect(find.text('Program Sekolah Hijau'), findsOneWidget);
    expect(find.text('Private Domain Only'), findsOneWidget);
    expect(find.text('Tourism Active'), findsOneWidget);
    expect(find.text('Draft Campaign'), findsNothing);
    expect(find.textContaining('Reward 1.5x'), findsOneWidget);
    expect(find.text('Org Sekolah'), findsOneWidget);
  });

  testWidgets('share button triggers share channel', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/public/campaigns')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/campaigns'),
        data: {'campaigns': campaignsJson()},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.share_outlined).first);
    await tester.pumpAndSettle();
  });

  testWidgets('shows empty eligible list', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    when(() => mockApi.get('/api/public/campaigns')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/campaigns'),
        data: {
          'campaigns': [
            {
              'id': 'c1',
              'name': 'Inactive',
              'status': 'ENDED',
              'visibility': 'PUBLIC',
              'campaignType': 'EVENT',
            },
          ],
        },
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(
      find.text('Tidak ada program yang memenuhi syarat Anda.'),
      findsOneWidget,
    );
  });

  testWidgets('shows error and retry', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    when(() => mockApi.get('/api/public/campaigns')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/public/campaigns'),
        type: DioExceptionType.connectionError,
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Coba Lagi'), findsOneWidget);

    when(() => mockApi.get('/api/public/campaigns')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/campaigns'),
        data: {'campaigns': []},
      ),
    );
    await tester.tap(find.text('Coba Lagi'));
    await tester.pumpAndSettle();
    expect(
      find.text('Tidak ada program yang memenuhi syarat Anda.'),
      findsOneWidget,
    );
  });
}
