import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/models.dart';
import '../helpers/test_helpers.dart';

void main() {
  group('ApiClient.getErrorMessage', () {
    DioException dio(DioExceptionType type, {int? status, dynamic data}) {
      return DioException(
        requestOptions: RequestOptions(path: '/x'),
        type: type,
        response: status == null
            ? null
            : Response(
                requestOptions: RequestOptions(path: '/x'),
                statusCode: status,
                data: data,
              ),
      );
    }

    test('maps timeout and connection types', () {
      expect(ApiClient.getErrorMessage(dio(DioExceptionType.connectionTimeout)),
          contains('timeout'));
      expect(ApiClient.getErrorMessage(dio(DioExceptionType.sendTimeout)),
          contains('mengirim'));
      expect(ApiClient.getErrorMessage(dio(DioExceptionType.receiveTimeout)),
          contains('tidak merespons'));
      expect(ApiClient.getErrorMessage(dio(DioExceptionType.cancel)),
          contains('dibatalkan'));
      expect(ApiClient.getErrorMessage(dio(DioExceptionType.connectionError)),
          contains('Tidak dapat terhubung'));
      expect(ApiClient.getErrorMessage(dio(DioExceptionType.badCertificate)),
          contains('jaringan'));
    });

    test('maps status codes and forwards 4xx server error', () {
      expect(
        ApiClient.getErrorMessage(dio(DioExceptionType.badResponse, status: 400, data: {'error': 'Bad'})),
        'Bad',
      );
      expect(ApiClient.getErrorMessage(dio(DioExceptionType.badResponse, status: 400)), 'Permintaan tidak valid.');
      expect(ApiClient.getErrorMessage(dio(DioExceptionType.badResponse, status: 401)), contains('Sesi'));
      expect(ApiClient.getErrorMessage(dio(DioExceptionType.badResponse, status: 403)), contains('akses'));
      expect(ApiClient.getErrorMessage(dio(DioExceptionType.badResponse, status: 404)), contains('tidak ditemukan'));
      expect(ApiClient.getErrorMessage(dio(DioExceptionType.badResponse, status: 409)), contains('sudah ada'));
      expect(ApiClient.getErrorMessage(dio(DioExceptionType.badResponse, status: 422)), contains('tidak valid'));
      expect(ApiClient.getErrorMessage(dio(DioExceptionType.badResponse, status: 429)), contains('Terlalu banyak'));
      expect(ApiClient.getErrorMessage(dio(DioExceptionType.badResponse, status: 500)), contains('server'));
      expect(ApiClient.getErrorMessage(dio(DioExceptionType.badResponse, status: 502)), contains('tidak tersedia'));
      expect(ApiClient.getErrorMessage(dio(DioExceptionType.badResponse, status: 503)), contains('tidak tersedia'));
      expect(ApiClient.getErrorMessage(dio(DioExceptionType.badResponse, status: 504)), contains('tidak tersedia'));
      expect(ApiClient.getErrorMessage(dio(DioExceptionType.badResponse, status: 418)), contains('Coba lagi'));
    });

    test('returns generic message for unknown errors', () {
      final msg = ApiClient.getErrorMessage(Exception('unknown'));
      expect(msg, 'Terjadi kesalahan yang tidak terduga.');
      expect(
        ApiClient.getErrorMessage(Exception('x'), includeDetails: true),
        contains('Terjadi kesalahan:'),
      );
    });

    test('baseUrl default is configurable', () {
      expect(ApiClient.baseUrl, 'http://localhost:3000');
      ApiClient.setBaseUrl('http://test.local:8080');
      expect(ApiClient.baseUrl, 'http://test.local:8080');
      ApiClient.setBaseUrl('http://localhost:3000');
    });
  });

  group('ApiClient HTTP verbs', () {
    test('get post patch delete and clearCookies work with adapter', () async {
      final client = ApiClient(baseUrl: 'http://test.local');
      // Allow cookie init fallback to finish.
      await Future<void>.delayed(const Duration(milliseconds: 50));

      client.dio.httpClientAdapter = MockHttpClientAdapter(
        statusCode: 200,
        responseData: '{"ok":true}',
      );

      final getRes = await client.get('/api/ping', queryParameters: {'a': 1});
      expect(getRes.statusCode, 200);

      final postRes = await client.post('/api/ping', data: {'x': 1});
      expect(postRes.statusCode, 200);

      final patchRes = await client.patch('/api/ping', data: {'x': 2});
      expect(patchRes.statusCode, 200);

      final deleteRes = await client.delete('/api/ping');
      expect(deleteRes.statusCode, 200);

      await client.clearCookies();
    });
  });

  group('DepositSession', () {
    test('fromJson parses full session', () {
      final json = {
        'id': 'session-1',
        'userId': 'user-1',
        'machineId': 'machine-1',
        'status': 'ACTIVE',
        'startedAt': '2024-01-01T00:00:00Z',
        'anomalyCount': 0,
        'machine': {
          'id': 'machine-1',
          'machineCode': 'RVM-001',
          'name': 'Mesin Test',
          'status': 'ONLINE',
          'fillLevelPercent': 50,
        },
      };

      final session = DepositSession.fromJson(json);
      expect(session.id, 'session-1');
      expect(session.status, 'ACTIVE');
      expect(session.machine?.name, 'Mesin Test');
    });

    test('fromJson handles missing fields', () {
      final json = {
        'id': 'session-1',
        'userId': 'user-1',
        'machineId': 'machine-1',
        'status': 'ACTIVE',
        'startedAt': '',
      };

      final session = DepositSession.fromJson(json);
      expect(session.anomalyCount, 0);
      expect(session.machine, isNull);
      expect(session.completedAt, isNull);
    });
  });

  group('CampaignInfo', () {
    test('fromJson parses campaign', () {
      final json = {
        'id': 'campaign-1',
        'name': 'Green Campaign',
        'description': 'A green campaign',
        'campaignType': 'EVENT',
        'visibility': 'PUBLIC',
        'status': 'ACTIVE',
        'organization': {'name': 'Org Test'},
      };

      final campaign = CampaignInfo.fromJson(json);
      expect(campaign.name, 'Green Campaign');
      expect(campaign.campaignType, 'EVENT');
      expect(campaign.status, 'ACTIVE');
      expect(campaign.organizationName, 'Org Test');
    });

    test('fromJson has sensible defaults', () {
      final json = {'id': '1', 'name': 'Test'};
      final campaign = CampaignInfo.fromJson(json);
      expect(campaign.campaignType, 'MACHINE_DEPOSIT');
      expect(campaign.visibility, 'PUBLIC');
      expect(campaign.status, 'DRAFT');
    });
  });
}
